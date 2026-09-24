import { ANTI_DENORMAL, BUTTERWORTH4_Q, highpassCoeffs, lowpassCoeffs } from "./filters";

/** rekordbox-style 3-band waveform; all bands share one scale so their relative levels are meaningful */
export interface Waveform {
  bucketsPerSecond: number;
  low: Uint8Array;
  mid: Uint8Array;
  high: Uint8Array;
  /** Broadband absolute peak per bucket, normalized to the track peak */
  peak: Uint8Array;
}

export type WaveformOverview = Omit<Waveform, "bucketsPerSecond">;

const LOW_MID_HZ = 250;
const MID_HIGH_HZ = 2500;
// Music energy falls off with frequency; tilt so mids/highs stay visible next to the kick
const BAND_GAIN = [1, 1.25, 2];

/** Split into low (<250 Hz) / mid / high (>2.5 kHz) bands and take per-bucket RMS */
export const computeWaveform = (mono: Float32Array, sampleRate: number, bucketsPerSecond: number = 150): Waveform => {
  const n = mono.length;
  const buckets = n > 0 ? Math.ceil((n * bucketsPerSecond) / sampleRate) : 0;
  const lowSq = new Float64Array(buckets);
  const midSq = new Float32Array(buckets);
  const highSq = new Float32Array(buckets);
  const counts = new Uint32Array(buckets);
  const peakAbs = new Float32Array(buckets);

  // Low: 4th-order LP. High: 4th-order HP. Mid: 2nd-order HP + 2nd-order LP.
  const { b0: l1b0, b1: l1b1, b2: l1b2, a1: l1a1, a2: l1a2 } = lowpassCoeffs(LOW_MID_HZ, sampleRate, BUTTERWORTH4_Q[0]);
  const { b0: l2b0, b1: l2b1, b2: l2b2, a1: l2a1, a2: l2a2 } = lowpassCoeffs(LOW_MID_HZ, sampleRate, BUTTERWORTH4_Q[1]);
  const { b0: m1b0, b1: m1b1, b2: m1b2, a1: m1a1, a2: m1a2 } = highpassCoeffs(LOW_MID_HZ, sampleRate);
  const { b0: m2b0, b1: m2b1, b2: m2b2, a1: m2a1, a2: m2a2 } = lowpassCoeffs(MID_HIGH_HZ, sampleRate);
  const {
    b0: h1b0,
    b1: h1b1,
    b2: h1b2,
    a1: h1a1,
    a2: h1a2,
  } = highpassCoeffs(MID_HIGH_HZ, sampleRate, BUTTERWORTH4_Q[0]);
  const {
    b0: h2b0,
    b1: h2b1,
    b2: h2b2,
    a1: h2a1,
    a2: h2a2,
  } = highpassCoeffs(MID_HIGH_HZ, sampleRate, BUTTERWORTH4_Q[1]);
  let l1z1 = 0,
    l1z2 = 0,
    l2z1 = 0,
    l2z2 = 0,
    m1z1 = 0,
    m1z2 = 0,
    m2z1 = 0,
    m2z2 = 0,
    h1z1 = 0,
    h1z2 = 0,
    h2z1 = 0,
    h2z2 = 0;
  let dn = ANTI_DENORMAL;

  const samplesPerBucket = sampleRate / bucketsPerSecond;
  for (let b = 0, i = 0; b < buckets; b++) {
    const end = Math.min(n, Math.floor((b + 1) * samplesPerBucket));
    let sl = 0;
    let sm = 0;
    let sh = 0;
    let pk = 0;
    const start = i;
    for (; i < end; i++) {
      const raw = mono[i];
      const x = raw + dn;
      dn = -dn;
      const a = raw < 0 ? -raw : raw;
      if (a > pk) pk = a;

      let y = l1b0 * x + l1z1;
      l1z1 = l1b1 * x - l1a1 * y + l1z2;
      l1z2 = l1b2 * x - l1a2 * y;
      const lo = l2b0 * y + l2z1;
      l2z1 = l2b1 * y - l2a1 * lo + l2z2;
      l2z2 = l2b2 * y - l2a2 * lo;

      y = m1b0 * x + m1z1;
      m1z1 = m1b1 * x - m1a1 * y + m1z2;
      m1z2 = m1b2 * x - m1a2 * y;
      const mi = m2b0 * y + m2z1;
      m2z1 = m2b1 * y - m2a1 * mi + m2z2;
      m2z2 = m2b2 * y - m2a2 * mi;

      y = h1b0 * x + h1z1;
      h1z1 = h1b1 * x - h1a1 * y + h1z2;
      h1z2 = h1b2 * x - h1a2 * y;
      const hi = h2b0 * y + h2z1;
      h2z1 = h2b1 * y - h2a1 * hi + h2z2;
      h2z2 = h2b2 * y - h2a2 * hi;

      sl += lo * lo;
      sm += mi * mi;
      sh += hi * hi;
    }
    lowSq[b] = sl;
    midSq[b] = sm;
    highSq[b] = sh;
    counts[b] = i - start;
    peakAbs[b] = pk;
  }

  const lowV = new Float32Array(buckets);
  const midV = new Float32Array(buckets);
  const highV = new Float32Array(buckets);
  let max = 0;
  let maxPeak = 0;
  for (let b = 0; b < buckets; b++) {
    // A 6.7 ms bucket is shorter than one bass cycle; average low energy over
    // three buckets so a steady 50 Hz tone doesn't ripple.
    const lo = b > 0 ? b - 1 : b;
    const hi = b < buckets - 1 ? b + 1 : b;
    let cnt = 0;
    let sum = 0;
    for (let j = lo; j <= hi; j++) {
      sum += lowSq[j];
      cnt += counts[j];
    }
    const c = counts[b] || 1;
    lowV[b] = BAND_GAIN[0] * Math.sqrt(sum / (cnt || 1));
    midV[b] = BAND_GAIN[1] * Math.sqrt(midSq[b] / c);
    highV[b] = BAND_GAIN[2] * Math.sqrt(highSq[b] / c);
    if (lowV[b] > max) max = lowV[b];
    if (midV[b] > max) max = midV[b];
    if (highV[b] > max) max = highV[b];
    if (peakAbs[b] > maxPeak) maxPeak = peakAbs[b];
  }

  const scale = max > 1e-9 ? 255 / max : 0;
  const peakScale = maxPeak > 1e-9 ? 255 / maxPeak : 0;
  const low = new Uint8Array(buckets);
  const mid = new Uint8Array(buckets);
  const high = new Uint8Array(buckets);
  const peak = new Uint8Array(buckets);
  for (let b = 0; b < buckets; b++) {
    // Uint8Array assignment truncates; round and clamp explicitly
    low[b] = Math.min(255, Math.round(lowV[b] * scale));
    mid[b] = Math.min(255, Math.round(midV[b] * scale));
    high[b] = Math.min(255, Math.round(highV[b] * scale));
    peak[b] = Math.min(255, Math.round(peakAbs[b] * peakScale));
  }
  return { bucketsPerSecond, low, mid, high, peak };
};

/** Reduce a waveform to `width` columns (max per column) for the whole-track overview strip */
export const computeOverview = (waveform: Waveform, width: number): WaveformOverview => {
  const cols = Math.max(0, Math.floor(width));
  const n = waveform.low.length;
  const reduce = (src: Uint8Array): Uint8Array => {
    const out = new Uint8Array(cols);
    if (n === 0) return out;
    for (let c = 0; c < cols; c++) {
      const start = Math.min(n - 1, Math.floor((c * n) / cols));
      const end = Math.max(start + 1, Math.min(n, Math.floor(((c + 1) * n) / cols)));
      let m = 0;
      for (let i = start; i < end; i++) if (src[i] > m) m = src[i];
      out[c] = m;
    }
    return out;
  };
  return {
    low: reduce(waveform.low),
    mid: reduce(waveform.mid),
    high: reduce(waveform.high),
    peak: reduce(waveform.peak),
  };
};
