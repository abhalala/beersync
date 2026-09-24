import { toCamelot } from "@beatsync/shared";
import { FFT } from "./fft";

export interface KeyResult {
  /** Camelot notation ("8A"), or null when there is no tonal content (silence) */
  camelot: string | null;
  /** Pearson correlation of the chroma with the winning key profile, clamped to 0..1 */
  confidence: number;
}

const FRAME_SIZE = 4096;
const HOP_SIZE = 2048;
const MIN_FREQ = 60;
const MAX_FREQ = 5000;
/** Cap on analyzed audio; frames are spread evenly over the whole track beyond this */
const MAX_ANALYZED_SEC = 120;

// Krumhansl–Kessler probe-tone profiles, index 0 = tonic
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const fftCache = new Map<number, FFT>();
const getFFT = (size: number): FFT => {
  let fft = fftCache.get(size);
  if (!fft) {
    fft = new FFT(size);
    fftCache.set(size, fft);
  }
  return fft;
};

/** Sum a pitch-class chromagram over (up to ~120 s of) the track */
export const computeChroma = (mono: Float32Array, sampleRate: number): Float64Array => {
  const n = FRAME_SIZE;
  const chroma = new Float64Array(12);
  if (mono.length === 0) return chroma;

  const fft = getFFT(n);
  const window = new Float64Array(n);
  for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));

  const binHz = sampleRate / n;
  const kLo = Math.max(2, Math.ceil(MIN_FREQ / binHz));
  const kHi = Math.min(n / 2 - 2, Math.floor(MAX_FREQ / binHz));
  const pcOfBin = new Int8Array(n / 2);
  for (let k = kLo; k <= kHi; k++) {
    const midi = 69 + 12 * Math.log2((k * binHz) / 440);
    pcOfBin[k] = ((Math.round(midi) % 12) + 12) % 12;
  }

  // Frame start positions: dense (hop 2048) for short tracks, evenly spread otherwise
  const span = Math.max(0, mono.length - n);
  const denseFrames = Math.floor(span / HOP_SIZE) + 1;
  const maxFrames = Math.max(1, Math.floor((MAX_ANALYZED_SEC * sampleRate) / HOP_SIZE));
  const frames = Math.min(denseFrames, maxFrames);
  const stride = frames > 1 ? (denseFrames <= maxFrames ? HOP_SIZE : span / (frames - 1)) : 0;

  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const magA = new Float64Array(n / 2);
  const magB = new Float64Array(n / 2);

  const fill = (target: Float64Array, start: number): void => {
    const end = Math.min(n, mono.length - start);
    for (let i = 0; i < end; i++) target[i] = mono[start + i] * window[i];
    for (let i = end; i < n; i++) target[i] = 0;
  };
  const accumulate = (mag: Float64Array): void => {
    // Only spectral peaks: broadband percussion adds little, tonal partials dominate
    for (let k = kLo; k <= kHi; k++) {
      const v = mag[k];
      if (v > mag[k - 1] && v >= mag[k + 1]) chroma[pcOfBin[k]] += v;
    }
  };

  // Two real frames per complex FFT (A in the real part, B in the imaginary)
  for (let f = 0; f < frames; f += 2) {
    fill(re, Math.round(f * stride));
    const hasB = f + 1 < frames;
    if (hasB) fill(im, Math.round((f + 1) * stride));
    else im.fill(0);
    fft.transform(re, im);
    for (let k = kLo - 1; k <= kHi + 1; k++) {
      const rk = re[k];
      const ik = im[k];
      const rn = re[n - k];
      const inn = im[n - k];
      // X_A = (Z_k + conj Z_{N-k}) / 2, X_B = (Z_k - conj Z_{N-k}) / 2i
      const ar = rk + rn;
      const ai = ik - inn;
      magA[k] = Math.sqrt(ar * ar + ai * ai);
      const br = ik + inn;
      const bi = rn - rk;
      magB[k] = Math.sqrt(br * br + bi * bi);
    }
    accumulate(magA);
    if (hasB) accumulate(magB);
  }
  return chroma;
};

const correlate = (chroma: Float64Array, profile: number[], tonic: number): number => {
  let cm = 0;
  let pm = 0;
  for (let i = 0; i < 12; i++) {
    cm += chroma[i];
    pm += profile[i];
  }
  cm /= 12;
  pm /= 12;
  let num = 0;
  let dc = 0;
  let dp = 0;
  for (let pc = 0; pc < 12; pc++) {
    const c = chroma[pc] - cm;
    const p = profile[(pc - tonic + 12) % 12] - pm;
    num += c * p;
    dc += c * c;
    dp += p * p;
  }
  return dc > 0 && dp > 0 ? num / Math.sqrt(dc * dp) : 0;
};

/** Krumhansl–Schmuckler key estimate, in Camelot notation */
export const detectKey = (mono: Float32Array, sampleRate: number): KeyResult => {
  const chroma = computeChroma(mono, sampleRate);
  let total = 0;
  for (let i = 0; i < 12; i++) total += chroma[i];
  if (!(total > 1e-6)) return { camelot: null, confidence: 0 };

  let best = -Infinity;
  let bestTonic = 0;
  let bestMode: "major" | "minor" = "major";
  for (let tonic = 0; tonic < 12; tonic++) {
    const major = correlate(chroma, MAJOR_PROFILE, tonic);
    if (major > best) {
      best = major;
      bestTonic = tonic;
      bestMode = "major";
    }
    const minor = correlate(chroma, MINOR_PROFILE, tonic);
    if (minor > best) {
      best = minor;
      bestTonic = tonic;
      bestMode = "minor";
    }
  }
  return { camelot: toCamelot(bestTonic, bestMode), confidence: Math.max(0, Math.min(1, best)) };
};
