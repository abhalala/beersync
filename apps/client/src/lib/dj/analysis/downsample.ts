import { ANTI_DENORMAL, BUTTERWORTH4_Q, lowpassCoeffs } from "./filters";

/** The subset of Web Audio's AudioBuffer the analysis needs (also satisfied by plain objects in workers/tests) */
export interface AudioBufferLike {
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

export interface MonoSignal {
  data: Float32Array;
  sampleRate: number;
}

/** Rate for tempo/key analysis: bands up to ~5 kHz are all they need */
export const ANALYSIS_SAMPLE_RATE = 11025;

/** Integer decimation factor whose output rate is >= targetRate */
export const decimationFactor = (sampleRate: number, targetRate: number): number =>
  Math.max(1, Math.floor(sampleRate / targetRate + 1e-9));

/** Mix all channels to mono and decimate to >= targetRate (integer factor, anti-aliased) */
export const downsampleToMono = (buffer: AudioBufferLike, targetRate: number = ANALYSIS_SAMPLE_RATE): MonoSignal => {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return decimateChannels(channels, buffer.length, buffer.sampleRate, targetRate);
};

/** Decimate a mono signal to >= targetRate (integer factor, anti-aliased) */
export const decimate = (
  mono: Float32Array,
  sampleRate: number,
  targetRate: number = ANALYSIS_SAMPLE_RATE
): MonoSignal => decimateChannels([mono], mono.length, sampleRate, targetRate);

const decimateChannels = (
  channels: Float32Array[],
  length: number,
  sampleRate: number,
  targetRate: number
): MonoSignal => {
  const nCh = channels.length;
  const factor = decimationFactor(sampleRate, targetRate);
  const outLen = Math.floor(length / factor);
  const out = new Float32Array(outLen);
  if (nCh === 0 || outLen === 0) return { data: out, sampleRate: sampleRate / factor };

  // Mono/stereo are mixed inside the filter loop (a mono source is read twice
  // and halved) so there is one monomorphic loop and no full-rate temp copy.
  let c0 = channels[0];
  let c1 = nCh > 1 ? channels[1] : c0;
  if (nCh > 2) {
    const mixed = new Float32Array(outLen * factor);
    for (let c = 0; c < nCh; c++) {
      const ch = channels[c];
      for (let i = 0; i < mixed.length; i++) mixed[i] += ch[i];
    }
    const gain = 1 / nCh;
    for (let i = 0; i < mixed.length; i++) mixed[i] *= gain;
    c0 = c1 = mixed;
  }

  if (factor === 1) {
    for (let i = 0; i < outLen; i++) out[i] = (c0[i] + c1[i]) * 0.5;
    return { data: out, sampleRate };
  }

  // 4th-order Butterworth low-pass just under the output Nyquist; a box
  // average would fold 5-11 kHz hats straight back into the key-detection band.
  const fc = (0.45 * sampleRate) / factor;
  const { b0: p0, b1: p1, b2: p2, a1: pa1, a2: pa2 } = lowpassCoeffs(fc, sampleRate, BUTTERWORTH4_Q[0]);
  const { b0: q0, b1: q1, b2: q2, a1: qa1, a2: qa2 } = lowpassCoeffs(fc, sampleRate, BUTTERWORTH4_Q[1]);
  let z1 = 0;
  let z2 = 0;
  let w1 = 0;
  let w2 = 0;
  let dn = ANTI_DENORMAL;
  const total = outLen * factor;
  for (let i = 0, phase = 0, o = 0; i < total; i++) {
    const x = (c0[i] + c1[i]) * 0.5 + dn;
    dn = -dn;
    const y = p0 * x + z1;
    z1 = p1 * x - pa1 * y + z2;
    z2 = p2 * x - pa2 * y;
    const v = q0 * y + w1;
    w1 = q1 * y - qa1 * v + w2;
    w2 = q2 * y - qa2 * v;
    if (phase === 0) out[o++] = v;
    if (++phase === factor) phase = 0;
  }
  return { data: out, sampleRate: sampleRate / factor };
};
