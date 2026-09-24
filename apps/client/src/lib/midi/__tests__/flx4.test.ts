import { describe, expect, it } from "bun:test";
import { createFlx4DecoderState, decodeFlx4, flx4LedMessages, tempoPositionToPitch } from "@/lib/midi/flx4";

const decode = (bytes: number[][]) => {
  const state = createFlx4DecoderState();
  return bytes.flatMap((b) => decodeFlx4(state, b));
};

describe("DDJ-FLX4 decoder", () => {
  it("assembles 14-bit faders from MSB then LSB, and only emits on the LSB", () => {
    // Deck B channel fader: MSB 0x13, LSB 0x33 on channel 1 (0xB1)
    expect(decode([[0xb1, 0x13, 0x40]])).toEqual([]);
    const [intent] = decode([
      [0xb1, 0x13, 0x7f],
      [0xb1, 0x33, 0x7f],
    ]);
    expect(intent).toEqual({ kind: "mixer", patch: { channels: { B: { fader: 1 } } } });
  });

  it("keeps each 14-bit control's MSB separate (EQ doesn't borrow the fader's MSB)", () => {
    const [intent] = decode([
      [0xb0, 0x13, 0x7f], // fader MSB (deck A)
      [0xb0, 0x0f, 0x40], // EQ low MSB = centre
      [0xb0, 0x2f, 0x00], // EQ low LSB
    ]);
    expect(intent.kind).toBe("mixer");
    const low = (intent as { patch: { channels: { A: { eqLow: number } } } }).patch.channels.A.eqLow;
    expect(Math.abs(low)).toBeLessThan(0.001); // centre detent is flat EQ
  });

  it("maps pads by hardware mode, and SHIFT + hot cue pad deletes the cue", () => {
    expect(decode([[0x97, 0x02, 0x7f]])).toEqual([
      { kind: "deck", deckId: "A", command: { type: "JUMP_HOT_CUE", index: 2 } },
    ]);
    expect(decode([[0x9a, 0x05, 0x7f]])).toEqual([
      { kind: "deck", deckId: "B", command: { type: "DELETE_HOT_CUE", index: 5 } },
    ]);
    expect(decode([[0x99, 0x24, 0x7f]])).toEqual([
      { kind: "deck", deckId: "B", command: { type: "BEAT_JUMP", beats: -4 } },
    ]);
    expect(decode([[0x97, 0x64, 0x7f]])).toEqual([
      { kind: "deck", deckId: "A", command: { type: "LOOP_AUTO", beats: 4 } },
    ]);
    // Pad release does nothing
    expect(decode([[0x97, 0x02, 0x00]])).toEqual([]);
  });

  it("reads jog and browse as signed relative ticks", () => {
    expect(decode([[0xb0, 0x21, 0x3e]])).toEqual([{ kind: "jog", deckId: "A", ticks: -2, mode: "bend" }]);
    expect(decode([[0xb1, 0x22, 0x43]])).toEqual([{ kind: "jog", deckId: "B", ticks: 3, mode: "platter" }]);
    expect(decode([[0xb6, 0x40, 0x7f]])).toEqual([{ kind: "browse", delta: -1 }]);
    expect(decode([[0xb6, 0x40, 0x01]])).toEqual([{ kind: "browse", delta: 1 }]);
  });

  it("maps the tempo fader centre to 0 % and its ends to the deck's range", () => {
    expect(tempoPositionToPitch(0.5, 10)).toBeCloseTo(0, 6);
    expect(tempoPositionToPitch(1, 16)).toBe(16);
    expect(tempoPositionToPitch(0, 6)).toBe(-6);
  });

  it("lights play, loop and set hot cue pads for the right deck", () => {
    const deck = { playing: false, loaded: true, atCue: true, looping: false, hotCues: Array(8).fill(false), level: 0 };
    const messages = flx4LedMessages({
      decks: { A: { ...deck, playing: true, hotCues: [true, ...Array(7).fill(false)] }, B: { ...deck, looping: true } },
    });
    const find = (s: number, d1: number) => messages.find(([ms, md]) => ms === s && md === d1)?.[2];
    expect(find(0x90, 0x0b)).toBe(0x7f); // deck A play
    expect(find(0x90, 0x0c)).toBe(0); // cue LED off while playing
    expect(find(0x91, 0x0c)).toBe(0x7f); // deck B paused at cue
    expect(find(0x91, 0x4d)).toBe(0x7f); // deck B looping
    expect(find(0x97, 0x00)).toBe(0x7f); // deck A pad 1 set
    expect(find(0x99, 0x00)).toBe(0); // deck B pad 1 empty
  });
});
