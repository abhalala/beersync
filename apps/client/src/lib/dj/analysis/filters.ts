// Biquad coefficients (RBJ audio EQ cookbook), normalized so a0 = 1. Filters are
// run inline in the hot loops of each analysis step (direct form II transposed)
// rather than through a helper call per sample, which V8 won't always inline.

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Q values for the two stages of a 4th-order Butterworth cascade */
export const BUTTERWORTH4_Q = [0.5411961, 1.306563] as const;

/**
 * Tiny alternating-sign offset added to filter inputs. Long runs of digital
 * silence would otherwise decay filter state into subnormal floats, which are
 * ~100x slower on x86. A Nyquist-rate signal this small is inaudible/invisible.
 */
export const ANTI_DENORMAL = 1e-15;

const clampCutoff = (fc: number, sampleRate: number): number => Math.min(Math.max(fc, 1), sampleRate * 0.45);

export const lowpassCoeffs = (fc: number, sampleRate: number, q: number = Math.SQRT1_2): BiquadCoeffs => {
  const w0 = (2 * Math.PI * clampCutoff(fc, sampleRate)) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cos) / 2 / a0,
    b1: (1 - cos) / a0,
    b2: (1 - cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
};

export const highpassCoeffs = (fc: number, sampleRate: number, q: number = Math.SQRT1_2): BiquadCoeffs => {
  const w0 = (2 * Math.PI * clampCutoff(fc, sampleRate)) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
};
