/** Iterative in-place radix-2 complex FFT with precomputed twiddles; reuse one instance per size. */
export class FFT {
  readonly size: number;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;
  private readonly reverse: Uint32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${size}`);
    this.size = size;
    const half = size >> 1;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / size);
      this.sinTable[i] = -Math.sin((2 * Math.PI * i) / size);
    }
    const bits = Math.log2(size);
    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0, v = i; b < bits; b++, v >>= 1) r = (r << 1) | (v & 1);
      this.reverse[i] = r;
    }
  }

  /** Forward transform (e^{-i 2π kn/N}), in place */
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    const rev = this.reverse;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }
    const cos = this.cosTable;
    const sin = this.sinTable;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let start = 0; start < n; start += len) {
        for (let j = 0, t = 0; j < half; j++, t += step) {
          const wr = cos[t];
          const wi = sin[t];
          const a = start + j;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }
}
