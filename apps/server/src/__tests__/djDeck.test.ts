import { describe, expect, it } from "bun:test";
import type { BeatGrid, DeckCommand, DeckId, DeckState, TrackMeta } from "@beatsync/shared";
import {
  beatPhase,
  createEmptyDeck,
  computeSync,
  crossfaderGains,
  deckPositionAt,
  isHarmonicMatch,
  quantizedStartTime,
  toCamelot,
} from "@beatsync/shared";
import { DeckManager } from "@/managers/DeckManager";

const A_URL = "https://cdn.test/room-1/a.mp3";
const B_URL = "https://cdn.test/room-1/b.mp3";
const DJ = { clientId: "dj-1", username: "Sam" };
const OTHER = { clientId: "dj-2", username: "Ria" };

const playing = (patch: Partial<DeckState>): DeckState => ({
  ...createEmptyDeck("A"),
  trackUrl: A_URL,
  status: "playing",
  ...patch,
});

// Phase difference in beats wrapped to [-0.5, 0.5)
const phaseDiff = (a: number, b: number) => {
  const d = a - b;
  return d - Math.round(d);
};

describe("deck timeline math", () => {
  it("wraps the playhead inside an active loop and honours the tempo", () => {
    const deck = playing({
      anchorServerTime: 1_000,
      anchorPositionSec: 10,
      pitchPercent: 10, // rate 1.1
      loop: { startSec: 10, endSec: 12 },
    });
    // 3 s of wall time at 1.1x = 3.3 s of track -> 13.3 wraps to 10 + (3.3 % 2)
    expect(deckPositionAt(deck, 4_000)).toBeCloseTo(11.3, 6);
  });

  it("does not wrap a playhead that is approaching a loop set ahead of it", () => {
    const deck = playing({ anchorServerTime: 0, anchorPositionSec: 5, loop: { startSec: 8, endSec: 9 } });
    expect(deckPositionAt(deck, 2_000)).toBeCloseTo(7, 6);
    expect(deckPositionAt(deck, 4_500)).toBeCloseTo(8.5, 6);
  });

  it("clamps to the track duration and reports the anchor before a scheduled start", () => {
    const deck = playing({ anchorServerTime: 10_000, anchorPositionSec: 30 });
    expect(deckPositionAt(deck, 5_000)).toBe(30);
    expect(deckPositionAt(deck, 100_000, 60)).toBe(60);
  });

  it("SYNC puts the slave on the master's tempo and beat phase", () => {
    const masterGrid: BeatGrid = { bpm: 128, firstBeatSec: 0.3 };
    const slaveGrid: BeatGrid = { bpm: 124, firstBeatSec: 0.11 };
    const master = playing({ anchorServerTime: 0, anchorPositionSec: 40, pitchPercent: 2 });
    const slave = playing({ anchorServerTime: 0, anchorPositionSec: 71.37 });
    const atMs = 5_000;

    const { pitchPercent, positionSec } = computeSync({ slave, slaveGrid, master, masterGrid, atMs });
    expect(124 * (1 + pitchPercent / 100)).toBeCloseTo(128 * 1.02, 6);

    // After the sync anchor, both decks must stay phase-locked
    const synced = { ...slave, anchorServerTime: atMs, anchorPositionSec: positionSec, pitchPercent };
    for (const t of [atMs, atMs + 7_300, atMs + 61_000]) {
      const drift = phaseDiff(
        beatPhase(deckPositionAt(synced, t), slaveGrid),
        beatPhase(deckPositionAt(master, t), masterGrid)
      );
      expect(Math.abs(drift)).toBeLessThan(1e-6);
    }
  });

  it("SYNC treats a half-time grid as double time instead of doubling the speed", () => {
    const { pitchPercent } = computeSync({
      slave: playing({}),
      slaveGrid: { bpm: 64, firstBeatSec: 0 },
      master: playing({}),
      masterGrid: { bpm: 128, firstBeatSec: 0 },
      atMs: 0,
    });
    expect(pitchPercent).toBeCloseTo(0, 6);
  });

  it("a quantized start lands the cue on the master's beat", () => {
    const masterGrid: BeatGrid = { bpm: 120, firstBeatSec: 0.2 };
    const slaveGrid: BeatGrid = { bpm: 120, firstBeatSec: 0 };
    const master = playing({ anchorServerTime: 0, anchorPositionSec: 10.33 });
    const cue = 32; // on a slave beat
    const startAt = quantizedStartTime({ slavePositionSec: cue, slaveGrid, master, masterGrid, atMs: 1_000 });

    expect(startAt).toBeGreaterThanOrEqual(1_000);
    expect(startAt - 1_000).toBeLessThan(500); // at most one beat of waiting
    expect(Math.abs(phaseDiff(beatPhase(deckPositionAt(master, startAt), masterGrid), 0))).toBeLessThan(1e-6);
  });

  it("smooth crossfader is constant power; sharp keeps both sides full in the middle", () => {
    const smooth = crossfaderGains(0.3, "smooth");
    expect(smooth.a ** 2 + smooth.b ** 2).toBeCloseTo(1, 6);
    expect(crossfaderGains(0, "sharp")).toEqual({ a: 1, b: 1 });
    expect(crossfaderGains(-1, "sharp").b).toBe(0);
  });

  it("maps keys onto the Camelot wheel for harmonic matching", () => {
    expect(toCamelot(9, "minor")).toBe("8A"); // A minor
    expect(toCamelot(0, "major")).toBe("8B"); // C major
    expect(isHarmonicMatch("8A", "9A")).toBe(true);
    expect(isHarmonicMatch("12A", "1A")).toBe(true);
    expect(isHarmonicMatch("8A", "8B")).toBe(true);
    expect(isHarmonicMatch("8A", "10A")).toBe(false);
  });
});

describe("DeckManager", () => {
  const metas: Record<string, TrackMeta> = {
    [A_URL]: { durationSec: 300, bpm: 128, firstBeatSec: 0.25 },
    [B_URL]: { durationSec: 240, bpm: 124, firstBeatSec: 0.1 },
  };
  const getTrackMeta = (url: string) => metas[url];

  const run = (
    dj: DeckManager,
    deckId: DeckId,
    command: DeckCommand,
    scheduleAtMs: number,
    actor = DJ,
    isAdmin = false
  ) => dj.applyCommand({ deckId, command, actor, isAdmin, scheduleAtMs, getTrackMeta });

  const loaded = () => {
    const dj = new DeckManager();
    run(dj, "A", { type: "LOAD", trackUrl: A_URL }, 0);
    run(dj, "B", { type: "LOAD", trackUrl: B_URL }, 0);
    run(dj, "A", { type: "SET_QUANTIZE", enabled: false }, 0);
    run(dj, "B", { type: "SET_QUANTIZE", enabled: false }, 0);
    return dj;
  };

  it("pause then play resumes exactly where the scheduled pause left the playhead", () => {
    const dj = loaded();
    run(dj, "A", { type: "PLAY" }, 1_000);
    run(dj, "A", { type: "PAUSE" }, 11_000);
    expect(dj.getDeck("A").anchorPositionSec).toBeCloseTo(10, 6);
    run(dj, "A", { type: "PLAY" }, 20_000);
    expect(deckPositionAt(dj.getDeck("A"), 25_000)).toBeCloseTo(15, 6);
  });

  it("never moves an anchor back in time when the scheduling delay shrinks", () => {
    const dj = loaded();
    run(dj, "A", { type: "PLAY" }, 5_000);
    run(dj, "A", { type: "SET_PITCH", pitchPercent: 4 }, 4_600); // arrived with a shorter delay
    const deck = dj.getDeck("A");
    expect(deck.anchorServerTime).toBe(5_000);
    expect(deck.anchorPositionSec).toBe(0);
  });

  it("keeps the anchor for edits that don't move the playhead, so clients don't restart audio", () => {
    const dj = loaded();
    run(dj, "A", { type: "PLAY" }, 1_000);
    const before = dj.getDeck("A");
    run(dj, "A", { type: "SET_HOT_CUE", index: 2 }, 9_000);
    const after = dj.getDeck("A");
    expect(after.hotCues[2]?.positionSec).toBeCloseTo(8, 6);
    expect(after.anchorServerTime).toBe(before.anchorServerTime);
    expect(after.anchorPositionSec).toBe(before.anchorPositionSec);
    expect(after.version).toBe(before.version + 1);
  });

  it("refuses to load over a playing deck (protects a live mix)", () => {
    const dj = loaded();
    run(dj, "A", { type: "PLAY" }, 1_000);
    const result = run(dj, "A", { type: "LOAD", trackUrl: B_URL }, 2_000);
    expect(result.ok).toBe(false);
    expect(dj.getDeck("A").trackUrl).toBe(A_URL);
  });

  it("enforces deck claims for other DJs but lets admins override", () => {
    const dj = loaded();
    dj.claimDeck({ deckId: "A", claim: true, actor: DJ, isAdmin: false });
    expect(run(dj, "A", { type: "PLAY" }, 1_000, OTHER).ok).toBe(false);
    expect(run(dj, "A", { type: "PLAY" }, 1_000, OTHER, true).ok).toBe(true);
  });

  it("SYNC on a playing deck phase-locks it to the master", () => {
    const dj = loaded();
    run(dj, "A", { type: "PLAY" }, 1_000);
    run(dj, "B", { type: "PLAY" }, 2_345);
    expect(dj.getMixer().masterDeck).toBe("A");

    const result = run(dj, "B", { type: "SYNC" }, 10_000);
    expect(result.ok).toBe(true);
    const a = dj.getDeck("A");
    const b = dj.getDeck("B");
    const gridA = { bpm: 128, firstBeatSec: 0.25 };
    const gridB = { bpm: 124, firstBeatSec: 0.1 };
    const t = 30_000;
    expect(
      Math.abs(phaseDiff(beatPhase(deckPositionAt(b, t), gridB), beatPhase(deckPositionAt(a, t), gridA)))
    ).toBeLessThan(1e-6);
  });

  it("a hot cue pressed mid-beat with quantize keeps the groove's phase", () => {
    const dj = loaded();
    run(dj, "A", { type: "SET_QUANTIZE", enabled: true }, 0);
    run(dj, "A", { type: "SEEK", positionSec: 20.25 }, 0); // on a beat
    run(dj, "A", { type: "SET_HOT_CUE", index: 0 }, 0);
    run(dj, "A", { type: "PLAY" }, 1_000);
    const before = dj.getDeck("A");
    run(dj, "A", { type: "JUMP_HOT_CUE", index: 0 }, 5_100); // 4.1 s later = mid-beat
    const after = dj.getDeck("A");
    const grid = { bpm: 128, firstBeatSec: 0.25 };
    expect(
      Math.abs(phaseDiff(beatPhase(after.anchorPositionSec, grid), beatPhase(deckPositionAt(before, 5_100), grid)))
    ).toBeLessThan(1e-6);
  });

  it("an auto loop set while playing contains the playhead and repeats seamlessly", () => {
    const dj = loaded();
    run(dj, "A", { type: "SET_QUANTIZE", enabled: true }, 0);
    run(dj, "A", { type: "PLAY" }, 0);
    run(dj, "A", { type: "LOOP_AUTO", beats: 4 }, 10_000);
    const deck = dj.getDeck("A");
    const loop = deck.loop!;
    expect(loop.endSec - loop.startSec).toBeCloseTo((4 * 60) / 128, 6);
    expect(deck.anchorPositionSec).toBeGreaterThanOrEqual(loop.startSec);
    expect(deck.anchorPositionSec).toBeLessThan(loop.endSec);
    // A minute later it's still inside the loop
    const later = deckPositionAt(deck, 70_000);
    expect(later).toBeGreaterThanOrEqual(loop.startSec);
    expect(later).toBeLessThan(loop.endSec);
  });

  it("ejects decks whose track was removed from the collection", () => {
    const dj = loaded();
    const changed = dj.ejectTracks([B_URL]);
    expect(changed.map((d) => d.deckId)).toEqual(["B"]);
    expect(dj.getDeck("B").status).toBe("empty");
    expect(dj.getDeck("A").trackUrl).toBe(A_URL);
  });
});
