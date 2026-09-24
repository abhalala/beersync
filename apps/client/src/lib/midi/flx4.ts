import type { DeckCommand, DeckId, MixerPatch } from "@beatsync/shared";

// Pioneer DDJ-FLX4 MIDI map (control numbers match the controller's MIDI
// spec as used by Mixxx's FLX4 mapping). The decoder is pure: raw bytes in,
// DJ intents out, so it can be unit-tested without hardware.
//
// Channels: deck A = 0, deck B = 1, mixer/browse = 6.
// Pads: deck A = 0x97 (0x98 with SHIFT), deck B = 0x99 (0x9A with SHIFT).
// The hardware itself tracks pad mode and SHIFT, sending different note numbers.

export type Flx4Intent =
  | { kind: "deck"; deckId: DeckId; command: DeckCommand }
  | { kind: "togglePlay"; deckId: DeckId }
  | { kind: "toggleLoop"; deckId: DeckId }
  | { kind: "toggleQuantize"; deckId: DeckId }
  | { kind: "cycleTempoRange"; deckId: DeckId }
  | { kind: "setMaster"; deckId: DeckId }
  | { kind: "jumpToStart"; deckId: DeckId }
  /** Tempo fader position, 0 = top (slowest) .. 1 = bottom (fastest), centre 0.5 */
  | { kind: "tempo"; deckId: DeckId; position: number }
  /** Jog ticks (positive = forward). "bend" = side ring, "platter" = top, "search" = SHIFT + platter */
  | { kind: "jog"; deckId: DeckId; ticks: number; mode: "bend" | "platter" | "search" }
  | { kind: "jogTouch"; deckId: DeckId; touching: boolean }
  | { kind: "mixer"; patch: MixerPatch }
  | { kind: "browse"; delta: number }
  | { kind: "load"; deckId: DeckId };

const NOTE_ON = 0x90;
const CC = 0xb0;
const MIXER_CHANNEL = 6;

const DECK_BY_CHANNEL: Record<number, DeckId> = { 0: "A", 1: "B" };
const PAD_STATUS: Record<number, { deckId: DeckId; shift: boolean }> = {
  0x97: { deckId: "A", shift: false },
  0x98: { deckId: "A", shift: true },
  0x99: { deckId: "B", shift: false },
  0x9a: { deckId: "B", shift: true },
};

/** Beat-jump pads: left column jumps back, right column forward (1, 2, 4, 8 beats) */
const BEAT_JUMP_PADS: Record<number, number> = {
  0x20: -1,
  0x21: 1,
  0x22: -2,
  0x23: 2,
  0x24: -4,
  0x25: 4,
  0x26: -8,
  0x27: 8,
};
/** Beat-loop pads: 1/4 .. 32 beats */
const BEAT_LOOP_PADS: Record<number, number> = {
  0x60: 0.25,
  0x61: 0.5,
  0x62: 1,
  0x63: 2,
  0x64: 4,
  0x65: 8,
  0x66: 16,
  0x67: 32,
};

// 14-bit controls: MSB number -> LSB number = MSB + 0x20
const DECK_14BIT = { tempo: 0x00, trim: 0x04, eqHigh: 0x07, eqMid: 0x0b, eqLow: 0x0f, fader: 0x13 } as const;
const MIXER_14BIT = { filterA: 0x17, filterB: 0x18, crossfader: 0x1f } as const;

/** Per-connection decoder memory (last MSB of each 14-bit control) */
export interface Flx4DecoderState {
  msb: Map<string, number>;
}

export const createFlx4DecoderState = (): Flx4DecoderState => ({ msb: new Map() });

const bipolar = (v: number) => Math.max(-1, Math.min(1, v * 2 - 1));

const decode14 = (state: Flx4DecoderState, key: string, control: number, value: number, msbNumber: number) => {
  if (control === msbNumber) {
    state.msb.set(key, value);
    return null;
  }
  // LSB completes the value; use the last MSB we saw (0 if none yet)
  return ((state.msb.get(key) ?? 0) * 128 + value) / 16383;
};

export const decodeFlx4 = (state: Flx4DecoderState, data: ArrayLike<number>): Flx4Intent[] => {
  if (data.length < 3) return [];
  const status = data[0];
  const d1 = data[1];
  const d2 = data[2];
  const type = status & 0xf0;
  const channel = status & 0x0f;
  const pressed = d2 > 0;

  // Performance pads
  const pad = PAD_STATUS[status];
  if (pad) {
    if (!pressed) return [];
    const { deckId, shift } = pad;
    if (d1 <= 0x07) {
      return [
        {
          kind: "deck",
          deckId,
          command: shift ? { type: "DELETE_HOT_CUE", index: d1 } : { type: "JUMP_HOT_CUE", index: d1 },
        },
      ];
    }
    if (!shift && BEAT_JUMP_PADS[d1] !== undefined) {
      return [{ kind: "deck", deckId, command: { type: "BEAT_JUMP", beats: BEAT_JUMP_PADS[d1] } }];
    }
    if (!shift && BEAT_LOOP_PADS[d1] !== undefined) {
      return [{ kind: "deck", deckId, command: { type: "LOOP_AUTO", beats: BEAT_LOOP_PADS[d1] } }];
    }
    return [];
  }

  // Browse section (note + CC on channel 6)
  if (channel === MIXER_CHANNEL) {
    if (type === NOTE_ON) {
      if (!pressed) return [];
      if (d1 === 0x46) return [{ kind: "load", deckId: "A" }];
      if (d1 === 0x47) return [{ kind: "load", deckId: "B" }];
      return [];
    }
    if (type === CC) {
      if (d1 === 0x40) return [{ kind: "browse", delta: d2 >= 64 ? d2 - 128 : d2 }];
      if (d1 === MIXER_14BIT.crossfader || d1 === MIXER_14BIT.crossfader + 0x20) {
        const v = decode14(state, "xf", d1, d2, MIXER_14BIT.crossfader);
        return v === null ? [] : [{ kind: "mixer", patch: { crossfader: bipolar(v) } }];
      }
      for (const [deckId, msb] of [
        ["A", MIXER_14BIT.filterA],
        ["B", MIXER_14BIT.filterB],
      ] as const) {
        if (d1 === msb || d1 === msb + 0x20) {
          const v = decode14(state, `filter${deckId}`, d1, d2, msb);
          return v === null ? [] : [{ kind: "mixer", patch: { channels: { [deckId]: { filter: bipolar(v) } } } }];
        }
      }
    }
    return [];
  }

  const deckId = DECK_BY_CHANNEL[channel];
  if (!deckId) return [];

  if (type === NOTE_ON) {
    if (d1 === 0x36 || d1 === 0x67) return [{ kind: "jogTouch", deckId, touching: pressed }];
    if (!pressed) return [];
    switch (d1) {
      case 0x0b:
        return [{ kind: "togglePlay", deckId }];
      case 0x0c:
        return [{ kind: "deck", deckId, command: { type: "CUE" } }];
      case 0x48:
        return [{ kind: "jumpToStart", deckId }];
      case 0x58:
        return [{ kind: "deck", deckId, command: { type: "SYNC" } }];
      case 0x5c:
        return [{ kind: "setMaster", deckId }];
      case 0x60:
        return [{ kind: "cycleTempoRange", deckId }];
      case 0x68:
        return [{ kind: "toggleQuantize", deckId }];
      case 0x10: // LOOP IN / 4 BEAT: instant 4-beat loop
        return [{ kind: "deck", deckId, command: { type: "LOOP_AUTO", beats: 4 } }];
      case 0x4d: // RELOOP/EXIT
        return [{ kind: "toggleLoop", deckId }];
      case 0x51: // CUE/LOOP CALL left: halve the active loop
        return [{ kind: "deck", deckId, command: { type: "LOOP_RESIZE", factor: 0.5 } }];
      case 0x53: // CUE/LOOP CALL right: double it
        return [{ kind: "deck", deckId, command: { type: "LOOP_RESIZE", factor: 2 } }];
      case 0x3e: // SHIFT + CUE/LOOP CALL left: quick jump back 16 beats
        return [{ kind: "deck", deckId, command: { type: "BEAT_JUMP", beats: -16 } }];
      case 0x3d:
        return [{ kind: "deck", deckId, command: { type: "BEAT_JUMP", beats: 16 } }];
      default:
        return [];
    }
  }

  if (type === CC) {
    // Jog wheels send relative ticks centred on 64
    if (d1 === 0x21) return [{ kind: "jog", deckId, ticks: d2 - 64, mode: "bend" }];
    if (d1 === 0x22 || d1 === 0x23) return [{ kind: "jog", deckId, ticks: d2 - 64, mode: "platter" }];
    if (d1 === 0x29) return [{ kind: "jog", deckId, ticks: d2 - 64, mode: "search" }];

    for (const [name, msb] of Object.entries(DECK_14BIT)) {
      if (d1 !== msb && d1 !== msb + 0x20) continue;
      const v = decode14(state, `${deckId}:${name}`, d1, d2, msb);
      if (v === null) return [];
      switch (name) {
        case "tempo":
          return [{ kind: "tempo", deckId, position: v }];
        case "trim":
          return [{ kind: "mixer", patch: { channels: { [deckId]: { trimDb: bipolar(v) * 12 } } } }];
        case "fader":
          return [{ kind: "mixer", patch: { channels: { [deckId]: { fader: v } } } }];
        default:
          return [{ kind: "mixer", patch: { channels: { [deckId]: { [name]: bipolar(v) } } } }];
      }
    }
  }
  return [];
};

/**
 * Tempo fader position to pitch percent. Like a CDJ, pulling the fader
 * towards you (higher MIDI value) speeds the track up; the centre is 0 %.
 */
export const tempoPositionToPitch = (position: number, tempoRange: number): number =>
  Math.max(-tempoRange, Math.min(tempoRange, (position * 2 - 1) * tempoRange));

// ── LED feedback ─────────────────────────────────────────────────────────────

export interface Flx4LedState {
  decks: Record<
    DeckId,
    { playing: boolean; loaded: boolean; atCue: boolean; looping: boolean; hotCues: boolean[]; level: number }
  >;
}

export type MidiMessage = [number, number, number];

/** Every LED message for a state; callers diff against what they last sent */
export const flx4LedMessages = (state: Flx4LedState): MidiMessage[] => {
  const out: MidiMessage[] = [];
  const on = (b: boolean) => (b ? 0x7f : 0x00);
  (["A", "B"] as const).forEach((deckId, ch) => {
    const d = state.decks[deckId];
    out.push([0x90 | ch, 0x0b, on(d.playing)]); // PLAY
    out.push([0x90 | ch, 0x0c, on(d.loaded && d.atCue && !d.playing)]); // CUE
    out.push([0x90 | ch, 0x4d, on(d.looping)]); // RELOOP/EXIT
    const padStatus = deckId === "A" ? 0x97 : 0x99;
    const shiftPadStatus = deckId === "A" ? 0x98 : 0x9a;
    d.hotCues.forEach((set, i) => {
      out.push([padStatus, i, on(set)]);
      out.push([shiftPadStatus, i, on(set)]);
    });
    out.push([0xb0 | ch, 0x02, Math.round(Math.max(0, Math.min(1, d.level)) * 127)]); // VU meter
  });
  return out;
};
