// Track analysis on synthetic signals: tempo octave folding (the classic
// half/double-time failure), grid phase accuracy, key mode, band separation,
// and sample-rate bookkeeping through the full downsampling pipeline.

import { describe, expect, it } from "bun:test";
import { analyzeTrack } from "@/lib/dj/analysis/analyze";
import { detectBeatGrid } from "@/lib/dj/analysis/bpm";
import { detectKey } from "@/lib/dj/analysis/key";
import { computeWaveform } from "@/lib/dj/analysis/waveform";

const SR = 11025;

// Deterministic PRNG (mulberry32) so failures are reproducible
const makeRng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Pitch-swept sine kick (150 -> 50 Hz) with exponential decay */
const addKick = (out: Float32Array, sr: number, t: number): void => {
  const start = Math.round(t * sr);
  let phase = 0;
  for (let i = 0; i < 0.25 * sr && start + i < out.length; i++) {
    const tt = i / sr;
    phase += (2 * Math.PI * (50 + 100 * Math.exp(-tt * 30))) / sr;
    out[start + i] += 0.8 * Math.exp(-tt * 12) * Math.sin(phase);
  }
};

/** Decaying white-noise burst: snare (slow decay) or hat (fast decay) */
const addNoise = (out: Float32Array, sr: number, t: number, amp: number, decay: number, rng: () => number): void => {
  const start = Math.round(t * sr);
  for (let i = 0; i < 0.2 * sr && start + i < out.length; i++) {
    out[start + i] += amp * Math.exp((-i / sr) * decay) * (rng() * 2 - 1);
  }
};

type Style = "fourOnFloor" | "drumAndBass" | "hipHop";

const drumTrack = (bpm: number, firstBeatSec: number, durationSec: number, sr: number, style: Style): Float32Array => {
  const out = new Float32Array(Math.round(durationSec * sr));
  const rng = makeRng(1);
  const beat = 60 / bpm;
  for (let k = 0; firstBeatSec + k * beat < durationSec; k++) {
    const t = firstBeatSec + k * beat;
    const inBar = k % 4;
    if (style === "fourOnFloor") {
      addKick(out, sr, t);
      addNoise(out, sr, t + beat / 2, 0.15, 40, rng);
      if (inBar % 2 === 1) addNoise(out, sr, t, 0.3, 15, rng);
    } else {
      // Kick on 1 & 3, snare on 2 & 4, hats on eighths
      if (inBar % 2 === 0) addKick(out, sr, t);
      else addNoise(out, sr, t, 0.5, 15, rng);
      addNoise(out, sr, t, 0.1, 50, rng);
      addNoise(out, sr, t + beat / 2, 0.1, 50, rng);
    }
  }
  for (let i = 0; i < out.length; i++) out[i] += 0.01 * (rng() * 2 - 1);
  return out;
};

/** Signed distance between two grid phases, modulo the beat length */
const phaseError = (a: number, b: number, beatLen: number): number => {
  let d = (a - b) % beatLen;
  if (d > beatLen / 2) d -= beatLen;
  if (d < -beatLen / 2) d += beatLen;
  return d;
};

describe("detectBeatGrid", () => {
  it("finds 128 BPM and a 0.23 s first beat within 15 ms", () => {
    const result = detectBeatGrid(drumTrack(128, 0.23, 30, SR, "fourOnFloor"), SR);
    expect(Math.abs(result.bpm - 128)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(phaseError(result.firstBeatSec, 0.23, 60 / 128))).toBeLessThanOrEqual(0.015);
    expect(result.firstBeatSec).toBeGreaterThanOrEqual(0);
    expect(result.firstBeatSec).toBeLessThan(60 / result.bpm);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("keeps drum & bass at 172, not half-time 86", () => {
    const result = detectBeatGrid(drumTrack(172, 0.41, 30, SR, "drumAndBass"), SR);
    expect(Math.abs(result.bpm - 172)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(phaseError(result.firstBeatSec, 0.41, 60 / 172))).toBeLessThanOrEqual(0.015);
  });

  it("keeps a 90 BPM groove with eighth-note hats at 90, not double-time 180", () => {
    const result = detectBeatGrid(drumTrack(90, 0.1, 30, SR, "hipHop"), SR);
    expect(Math.abs(result.bpm - 90)).toBeLessThanOrEqual(0.1);
  });

  it("resolves fractional tempos instead of snapping them to an integer", () => {
    const result = detectBeatGrid(drumTrack(123.7, 0.05, 30, SR, "fourOnFloor"), SR);
    expect(Math.abs(result.bpm - 123.7)).toBeLessThanOrEqual(0.02);
  });

  it("returns the neutral default with zero confidence for silence", () => {
    expect(detectBeatGrid(new Float32Array(10 * SR), SR)).toEqual({ bpm: 120, firstBeatSec: 0, confidence: 0 });
  });
});

describe("detectKey", () => {
  const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

  // Chord tones with a few harmonics, 2 s each
  const progression = (chords: number[][], secPerChord: number): Float32Array => {
    const len = Math.round(secPerChord * SR);
    const out = new Float32Array(len * chords.length);
    chords.forEach((chord, c) => {
      for (const note of chord) {
        const w = (2 * Math.PI * midiHz(note)) / SR;
        for (let i = 0; i < len; i++) {
          const env = Math.min(1, i / 200) * Math.exp((-i / SR) * 0.8);
          out[c * len + i] += 0.15 * env * (Math.sin(w * i) + 0.4 * Math.sin(2 * w * i) + 0.2 * Math.sin(3 * w * i));
        }
      }
    });
    return out;
  };

  it("labels an Am-Dm-Em-Am progression as 8A (not its relative major 8B)", () => {
    const Am = [45, 57, 60, 64];
    const Dm = [50, 62, 65, 69];
    const Em = [52, 64, 67, 71];
    const result = detectKey(progression([Am, Dm, Em, Am, Am, Dm, Em, Am], 2), SR);
    expect(result.camelot).toBe("8A");
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

describe("computeWaveform", () => {
  const sine = (hz: number, sr: number, sec: number): Float32Array => {
    const out = new Float32Array(Math.round(sr * sec));
    for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / sr);
    return out;
  };
  const mean = (a: Uint8Array): number => a.reduce((s, v) => s + v, 0) / a.length;

  it("puts a 60 Hz sine in the low band only", () => {
    const w = computeWaveform(sine(60, SR, 2), SR);
    expect(w.low.length).toBe(300);
    expect(mean(w.low)).toBeGreaterThan(200);
    expect(mean(w.high)).toBeLessThan(3);
  });

  it("puts an 8 kHz sine in the high band only", () => {
    const w = computeWaveform(sine(8000, 22050, 2), 22050);
    expect(mean(w.high)).toBeGreaterThan(200);
    expect(mean(w.low)).toBeLessThan(3);
  });
});

describe("analyzeTrack", () => {
  it("keeps tempo and timing correct through stereo 44.1 kHz downsampling", () => {
    const sr = 44100;
    const left = drumTrack(126, 0.3, 20, sr, "fourOnFloor");
    const right = left.slice();
    const result = analyzeTrack({
      numberOfChannels: 2,
      sampleRate: sr,
      length: left.length,
      getChannelData: (c) => (c === 0 ? left : right),
    });
    expect(Math.abs(result.bpm - 126)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(phaseError(result.firstBeatSec, 0.3, 60 / 126))).toBeLessThanOrEqual(0.015);
    expect(result.durationSec).toBeCloseTo(20, 3);
    expect(result.waveform.low.length).toBe(20 * 150);
  });
});
