import { ANTI_DENORMAL, lowpassCoeffs } from "./filters";

export interface BeatGridResult {
  bpm: number;
  /** Earliest grid beat >= 0, in [0, 60 / bpm) */
  firstBeatSec: number;
  /** 0 (no periodicity / silence) .. 1 (metronomic) */
  confidence: number;
}

export interface OnsetEnvelope {
  /** Rectified, locally detrended onset strength per hop */
  envelope: Float32Array;
  frameRate: number;
  hopSize: number;
}

const HOP_SEC = 0.01;
const SEARCH_MIN_BPM = 70;
const SEARCH_MAX_BPM = 180;
// DJ-friendly fold range: every tempo has exactly one or two octaves in here
const FOLD_MIN_BPM = 85;
const FOLD_MAX_BPM = 175;
const HARMONIC_WEIGHTS = [1, 0.75, 0.5, 0.5];
const FOLD_BINS = 48;
/**
 * Where the true attack sits relative to the interpolated flux peak, in hops:
 * the peak lands ~0.3 hop early because the jump is credited to the start of
 * the hop that contains the attack. Calibrated on synthetic kicks.
 */
const ONSET_FRAME_OFFSET = 0.28;

const SILENT_RESULT: BeatGridResult = { bpm: 120, firstBeatSec: 0, confidence: 0 };

/**
 * Onset strength: positive log-energy increases per 10 ms hop, in a low band
 * (< 150 Hz, kicks/bass) and the remainder, weighted toward lows because DJ
 * music is gridded on the kick. Returns null for (near) silence.
 */
export const onsetEnvelope = (mono: Float32Array, sampleRate: number): OnsetEnvelope | null => {
  const hop = Math.max(1, Math.round(sampleRate * HOP_SEC));
  const frames = Math.floor(mono.length / hop);
  if (frames < 3) return null;
  const lowE = new Float32Array(frames);
  const restE = new Float32Array(frames);

  const { b0, b1, b2, a1, a2 } = lowpassCoeffs(150, sampleRate);
  let z1 = 0;
  let z2 = 0;
  let dn = ANTI_DENORMAL;
  let sumLow = 0;
  let sumRest = 0;
  for (let f = 0, i = 0; f < frames; f++) {
    let el = 0;
    let er = 0;
    for (let j = 0; j < hop; j++, i++) {
      const x = mono[i] + dn;
      dn = -dn;
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      const r = x - y;
      el += y * y;
      er += r * r;
    }
    lowE[f] = el;
    restE[f] = er;
    sumLow += el;
    sumRest += er;
  }
  const meanLow = sumLow / frames;
  const meanRest = sumRest / frames;
  const meanTotal = meanLow + meanRest;
  // ~-80 dBFS average: nothing to find a beat in
  if (meanTotal / hop < 1e-8) return null;

  // Normalize each band by its own mean so the log compression behaves the same
  // for quiet and loud masters; floor the reference so a band that holds only
  // noise (e.g. no bass at all) isn't amplified into fake onsets.
  const refLow = 100 / Math.max(meanLow, 1e-3 * meanTotal);
  const refRest = 100 / Math.max(meanRest, 1e-3 * meanTotal);
  const flux = new Float32Array(frames);
  let prevLow = Math.log1p(lowE[0] * refLow);
  let prevRest = Math.log1p(restE[0] * refRest);
  for (let f = 1; f < frames; f++) {
    const l = Math.log1p(lowE[f] * refLow);
    const r = Math.log1p(restE[f] * refRest);
    const dl = l - prevLow;
    const dr = r - prevRest;
    flux[f] = (dl > 0 ? dl : 0) + (dr > 0 ? 0.5 * dr : 0);
    prevLow = l;
    prevRest = r;
  }

  // Subtract a ~0.5 s moving average and half-wave rectify: keeps the peaks,
  // drops the flux floor of sustained noisy sections.
  const frameRate = sampleRate / hop;
  const half = Math.max(1, Math.round(frameRate * 0.25));
  const prefix = new Float64Array(frames + 1);
  for (let f = 0; f < frames; f++) prefix[f + 1] = prefix[f] + flux[f];
  const envelope = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const lo = Math.max(0, f - half);
    const hi = Math.min(frames, f + half + 1);
    const v = flux[f] - (prefix[hi] - prefix[lo]) / (hi - lo);
    envelope[f] = v > 0 ? v : 0;
  }
  return { envelope, frameRate, hopSize: hop };
};

/** Detect a constant-tempo beat grid: tempo (folded to 85-175 BPM) and phase */
export const detectBeatGrid = (mono: Float32Array, sampleRate: number): BeatGridResult => {
  if (mono.length < sampleRate * 3) return { ...SILENT_RESULT };
  const onset = onsetEnvelope(mono, sampleRate);
  if (!onset) return { ...SILENT_RESULT };
  const { envelope, frameRate, hopSize } = onset;

  const rawBpm = estimateTempo(envelope, frameRate);
  if (rawBpm === null) return { ...SILENT_RESULT };
  const foldedBpm = foldTempo(rawBpm, envelope, frameRate);
  const grid = refineGrid(envelope, frameRate, foldedBpm);

  const beatLen = 60 / grid.bpm;
  const t = ((grid.phaseFrames + ONSET_FRAME_OFFSET) * hopSize) / sampleRate;
  let firstBeatSec = ((t % beatLen) + beatLen) % beatLen;
  if (firstBeatSec >= beatLen - 1e-9) firstBeatSec = 0;
  return { bpm: grid.bpm, firstBeatSec, confidence: grid.confidence };
};

/**
 * Autocorrelation tempo over 70-180 BPM. Each candidate period is scored by the
 * autocorrelation at its first four multiples, which favours the true beat
 * period over sub-beat (e.g. 3:2) periodicities that only line up sometimes.
 */
const estimateTempo = (env: Float32Array, frameRate: number): number | null => {
  const m = env.length;
  const tauMin = (60 * frameRate) / SEARCH_MAX_BPM;
  const tauMax = (60 * frameRate) / SEARCH_MIN_BPM;
  if (m < tauMax * 3) return null;
  const maxLag = Math.min(Math.ceil(HARMONIC_WEIGHTS.length * tauMax) + 2, m - 1);
  const minLag = Math.max(1, Math.floor(tauMin) - 1);

  let mean = 0;
  for (let i = 0; i < m; i++) mean += env[i];
  mean /= m;
  const x = new Float32Array(m);
  let energy = 0;
  for (let i = 0; i < m; i++) {
    x[i] = env[i] - mean;
    energy += x[i] * x[i];
  }
  if (energy <= 1e-12) return null;

  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    const end = m - lag;
    for (let i = 0; i < end; i++) s += x[i] * x[i + lag];
    ac[lag] = s / end;
  }
  // Light smoothing so fractional multiples still see a peak one lag away
  const acs = new Float64Array(maxLag + 2);
  for (let lag = minLag + 1; lag < maxLag; lag++) acs[lag] = 0.25 * ac[lag - 1] + 0.5 * ac[lag] + 0.25 * ac[lag + 1];

  const interp = (pos: number): number => {
    const i = Math.floor(pos);
    const f = pos - i;
    return acs[i] * (1 - f) + acs[i + 1] * f;
  };

  let bestTau = -1;
  let bestScore = -Infinity;
  for (let tau = tauMin; tau <= tauMax; tau += 0.05) {
    let score = 0;
    let wsum = 0;
    for (let k = 0; k < HARMONIC_WEIGHTS.length; k++) {
      const pos = (k + 1) * tau;
      if (pos >= maxLag - 1) break;
      score += HARMONIC_WEIGHTS[k] * interp(pos);
      wsum += HARMONIC_WEIGHTS[k];
    }
    score /= wsum;
    if (score > bestScore) {
      bestScore = score;
      bestTau = tau;
    }
  }
  if (bestTau <= 0 || bestScore <= 0) return null;
  return (60 * frameRate) / bestTau;
};

/**
 * Fold into 85-175 BPM. Only tempos near 86/172 have two octaves in range;
 * there, choose double time when the half-beats carry real onsets (drum & bass
 * snares), since a DJ grid at half-time would put every other hit off-grid.
 */
const foldTempo = (bpm: number, env: Float32Array, frameRate: number): number => {
  const candidates: number[] = [];
  for (let k = -3; k <= 3; k++) {
    const c = bpm * Math.pow(2, k);
    if (c >= FOLD_MIN_BPM && c <= FOLD_MAX_BPM) candidates.push(c);
  }
  if (candidates.length === 0) return bpm;
  if (candidates.length === 1) return candidates[0];
  const slow = Math.min(...candidates);
  const fast = Math.max(...candidates);

  const hist = new Float64Array(FOLD_BINS);
  foldHistogram(env, (60 * frameRate) / slow, hist);
  const smooth = smoothCircular(hist);
  let peak = 0;
  for (let i = 1; i < FOLD_BINS; i++) if (smooth[i] > smooth[peak]) peak = i;
  const halfBeat = smooth[(peak + FOLD_BINS / 2) % FOLD_BINS];
  return smooth[peak] > 0 && halfBeat / smooth[peak] >= 0.35 ? fast : slow;
};

/** Accumulate the envelope into `bins` phase bins of one beat period (frames) */
const foldHistogram = (env: Float32Array, period: number, out: Float64Array): void => {
  const bins = out.length;
  out.fill(0);
  const scale = bins / period;
  let phase = 0;
  for (let i = 0; i < env.length; i++) {
    const v = env[i];
    if (v > 0) {
      let b = Math.floor(phase * scale);
      if (b >= bins) b = bins - 1;
      out[b] += v;
    }
    phase += 1;
    if (phase >= period) phase -= period;
  }
};

const smoothCircular = (h: Float64Array): Float64Array => {
  const n = h.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.5 * h[(i + n - 1) % n] + h[i] + 0.5 * h[(i + 1) % n];
  return out;
};

interface GridFit {
  bpm: number;
  phaseFrames: number;
  confidence: number;
}

/**
 * Refine tempo and phase: a fine comb (phase histogram) search around the
 * folded tempo, then a weighted least-squares line through the per-beat onset
 * peaks — hundreds of beats pin the period far below the 10 ms hop.
 */
const refineGrid = (env: Float32Array, frameRate: number, bpm0: number): GridFit => {
  const hist = new Float64Array(FOLD_BINS);
  let bestBpm = bpm0;
  let bestScore = -Infinity;
  let bestBin = 0;
  for (let bpm = bpm0 * 0.98; bpm <= bpm0 * 1.02; bpm += 0.02) {
    foldHistogram(env, (60 * frameRate) / bpm, hist);
    const smooth = smoothCircular(hist);
    for (let i = 0; i < FOLD_BINS; i++) {
      if (smooth[i] > bestScore) {
        bestScore = smooth[i];
        bestBpm = bpm;
        bestBin = i;
      }
    }
  }

  let period = (60 * frameRate) / bestBpm;
  let phase = ((bestBin + 0.5) * period) / FOLD_BINS;
  const m = env.length;
  const maxBeats = Math.floor(m / period) + 2;
  const ks = new Float64Array(maxBeats);
  const pos = new Float64Array(maxBeats);
  const w = new Float64Array(maxBeats);
  let count = 0;
  let inliers = 0;

  const collect = (windowFrac: number): void => {
    count = 0;
    const win = Math.max(2, Math.round(period * windowFrac));
    for (let k = 0; ; k++) {
      const c = Math.round(phase + k * period);
      if (c - win >= m - 1) break;
      const lo = Math.max(1, c - win);
      const hi = Math.min(m - 2, c + win);
      let best = -1;
      let bestV = 0;
      for (let i = lo; i <= hi; i++) {
        if (env[i] > bestV) {
          bestV = env[i];
          best = i;
        }
      }
      if (best < 0 || count >= maxBeats) continue;
      const l = env[best - 1];
      const r = env[best + 1];
      const denom = l - 2 * bestV + r;
      const delta = denom < 0 ? (0.5 * (l - r)) / denom : 0;
      ks[count] = k;
      pos[count] = best + Math.max(-0.5, Math.min(0.5, delta));
      w[count] = bestV;
      count++;
    }
  };

  // Weighted LS of pos = a + k * period, then drop outliers (breakdowns,
  // fills) and refit.
  const fit = (maxResidual: number): boolean => {
    let sw = 0;
    let sk = 0;
    let skk = 0;
    let sp = 0;
    let skp = 0;
    let n = 0;
    for (let i = 0; i < count; i++) {
      if (w[i] <= 0) continue;
      if (maxResidual < Infinity && Math.abs(pos[i] - (phase + ks[i] * period)) > maxResidual) continue;
      const wi = w[i];
      sw += wi;
      sk += wi * ks[i];
      skk += wi * ks[i] * ks[i];
      sp += wi * pos[i];
      skp += wi * ks[i] * pos[i];
      n++;
    }
    const det = sw * skk - sk * sk;
    if (n < 8 || det <= 0) return false;
    const p = (sw * skp - sk * sp) / det;
    if (!(p > 0) || Math.abs(p / period - 1) > 0.03) return false;
    period = p;
    phase = (sp - p * sk) / sw;
    inliers = n;
    return true;
  };

  collect(0.15);
  fit(Infinity);
  fit(0.06 * period);
  collect(0.08);
  fit(Infinity);
  fit(0.04 * period);

  let bpm = Math.round(((60 * frameRate) / period) * 100) / 100;
  // Most dance music is produced at integer BPM
  if (Math.abs(bpm - Math.round(bpm)) < 0.05) bpm = Math.round(bpm);
  const finalPeriod = (60 * frameRate) / bpm;

  // Re-anchor the phase for the rounded period (weighted mean over inliers)
  let sw = 0;
  let sa = 0;
  for (let i = 0; i < count; i++) {
    const predicted = phase + ks[i] * period;
    if (w[i] <= 0 || Math.abs(pos[i] - predicted) > 0.04 * period) continue;
    sw += w[i];
    sa += w[i] * (pos[i] - ks[i] * finalPeriod);
  }
  if (sw > 0) phase = sa / sw;

  // Confidence: how concentrated onset energy is at the grid phase, scaled by
  // the share of beats that had an onset where the grid predicts one.
  foldHistogram(env, finalPeriod, hist);
  const smooth = smoothCircular(hist);
  let max = 0;
  let total = 0;
  for (let i = 0; i < FOLD_BINS; i++) {
    total += smooth[i];
    if (smooth[i] > max) max = smooth[i];
  }
  const mean = total / FOLD_BINS;
  const peakiness = max > 0 ? (max - mean) / max : 0;
  const expectedBeats = Math.max(1, Math.floor(m / finalPeriod));
  const coverage = Math.min(1, inliers / expectedBeats);
  const confidence = Math.max(0, Math.min(1, ((peakiness - 0.3) / 0.6) * Math.sqrt(coverage)));

  return { bpm, phaseFrames: phase, confidence };
};
