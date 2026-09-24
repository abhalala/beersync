import type { CrossfaderAssign, CrossfaderCurve, MixerChannel, MixerState } from "../types/dj";

// Mixer curves shared by the engine (audio) and UI (meters, labels).

export const EQ_KILL_DB = -40;
export const EQ_BOOST_DB = 6;

/** EQ knob (-1..1) to dB: quadratic cut down to a -40 dB kill, linear boost to +6 dB */
export const eqKnobToDb = (value: number): number => {
  const v = Math.max(-1, Math.min(1, value));
  return v < 0 ? EQ_KILL_DB * v * v : EQ_BOOST_DB * v;
};

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

export const FILTER_DEADZONE = 0.02;
const LOWPASS_MIN_HZ = 150;
const HIGHPASS_MAX_HZ = 8000;
export const FILTER_OPEN_LOWPASS_HZ = 22000;
export const FILTER_OPEN_HIGHPASS_HZ = 10;

/** Bipolar filter knob to cutoff frequencies (exponential sweeps) */
export const filterKnobToFreqs = (value: number): { lowpassHz: number; highpassHz: number } => {
  const v = Math.max(-1, Math.min(1, value));
  if (Math.abs(v) < FILTER_DEADZONE) {
    return { lowpassHz: FILTER_OPEN_LOWPASS_HZ, highpassHz: FILTER_OPEN_HIGHPASS_HZ };
  }
  if (v < 0) {
    const t = (-v - FILTER_DEADZONE) / (1 - FILTER_DEADZONE);
    return {
      lowpassHz: 20000 * Math.pow(LOWPASS_MIN_HZ / 20000, t),
      highpassHz: FILTER_OPEN_HIGHPASS_HZ,
    };
  }
  const t = (v - FILTER_DEADZONE) / (1 - FILTER_DEADZONE);
  return {
    lowpassHz: FILTER_OPEN_LOWPASS_HZ,
    highpassHz: 20 * Math.pow(HIGHPASS_MAX_HZ / 20, t),
  };
};

/**
 * Crossfader gains for the A and B sides. Smooth = constant power (both at
 * ~0.71 in the centre); sharp = scratch curve (both full until the last few %).
 */
export const crossfaderGains = (position: number, curve: CrossfaderCurve): { a: number; b: number } => {
  const t = (Math.max(-1, Math.min(1, position)) + 1) / 2; // 0 = full A, 1 = full B
  if (curve === "sharp") {
    const cut = 0.06;
    return {
      a: Math.max(0, Math.min(1, (1 - t) / cut)),
      b: Math.max(0, Math.min(1, t / cut)),
    };
  }
  return { a: Math.cos((t * Math.PI) / 2), b: Math.sin((t * Math.PI) / 2) };
};

export const crossfaderGainFor = (assign: CrossfaderAssign, gains: { a: number; b: number }): number =>
  assign === "A" ? gains.a : assign === "B" ? gains.b : 1;

/** Linear post-EQ gain a channel contributes to the master (trim x fader x crossfader) */
export const channelOutputGain = (
  channel: MixerChannel,
  mixer: Pick<MixerState, "crossfader" | "crossfaderCurve">
): number => {
  const xf = crossfaderGainFor(channel.crossfaderAssign, crossfaderGains(mixer.crossfader, mixer.crossfaderCurve));
  // Fader uses a squared taper so the top of the throw feels like a real mixer
  return dbToGain(channel.trimDb) * channel.fader * channel.fader * xf;
};

export const DEFAULT_MIXER_CHANNEL: MixerChannel = {
  trimDb: 0,
  eqHigh: 0,
  eqMid: 0,
  eqLow: 0,
  filter: 0,
  fader: 0.85,
  crossfaderAssign: "THRU",
};
