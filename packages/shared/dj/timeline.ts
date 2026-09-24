import type { BeatGrid, DeckState, Loop } from "../types/dj";

// Pure, deterministic deck math shared by the server and every client, so all
// devices agree on where a deck's playhead is at any server time.

export type DeckTimeline = Pick<
  DeckState,
  "status" | "anchorServerTime" | "anchorPositionSec" | "pitchPercent" | "loop"
>;

/** Playback rate implied by the tempo fader */
export const deckRate = (deck: Pick<DeckState, "pitchPercent">): number => 1 + deck.pitchPercent / 100;

/** Wrap a position into a loop once it has reached the loop end */
export const wrapIntoLoop = (positionSec: number, loop: Loop | null): number => {
  if (!loop) return positionSec;
  const length = loop.endSec - loop.startSec;
  if (length <= 0 || positionSec < loop.endSec) return positionSec;
  return loop.startSec + ((positionSec - loop.startSec) % length);
};

/**
 * Where the playhead is at `serverTimeMs`. Before the anchor time a playing deck
 * reports its anchor position (it is about to start from there).
 */
export const deckPositionAt = (deck: DeckTimeline, serverTimeMs: number, durationSec?: number): number => {
  let position = deck.anchorPositionSec;
  if (deck.status === "playing") {
    const elapsedSec = (Math.max(0, serverTimeMs - deck.anchorServerTime) / 1000) * deckRate(deck);
    position = wrapIntoLoop(deck.anchorPositionSec + elapsedSec, deck.loop);
  }
  if (durationSec !== undefined) position = Math.min(position, durationSec);
  return Math.max(0, position);
};

// ── Beat grid ────────────────────────────────────────────────────────────────

/** Length of one beat in track seconds */
export const beatLengthSec = (bpm: number): number => 60 / bpm;

/** Fractional position within the current beat, in [0, 1) */
export const beatPhase = (positionSec: number, grid: BeatGrid): number => {
  const beats = (positionSec - grid.firstBeatSec) / beatLengthSec(grid.bpm);
  return beats - Math.floor(beats);
};

export const nearestBeatSec = (positionSec: number, grid: BeatGrid): number => {
  const len = beatLengthSec(grid.bpm);
  return grid.firstBeatSec + Math.round((positionSec - grid.firstBeatSec) / len) * len;
};

export const previousBeatSec = (positionSec: number, grid: BeatGrid): number => {
  const len = beatLengthSec(grid.bpm);
  // Small epsilon so a position sitting exactly on a beat counts as that beat
  return grid.firstBeatSec + Math.floor((positionSec - grid.firstBeatSec) / len + 1e-6) * len;
};

/** Wrap a phase difference to [-0.5, 0.5) beats */
const wrapPhaseDelta = (delta: number): number => delta - Math.round(delta);

/**
 * Pick the tempo multiplier (half, normal, double time) that lets `bpm` reach
 * `targetBpm` with the smallest rate change, and return the rate that does it.
 */
export const matchTempo = (bpm: number, targetBpm: number): { rate: number; multiplier: number } => {
  let best = { rate: targetBpm / bpm, multiplier: 1 };
  for (const multiplier of [0.5, 2]) {
    const rate = targetBpm / (bpm * multiplier);
    if (Math.abs(Math.log(rate)) < Math.abs(Math.log(best.rate))) best = { rate, multiplier };
  }
  return best;
};

/**
 * SYNC: the tempo and (when both decks play) playhead position that put `slave`
 * on the master's tempo and beat phase at server time `atMs`.
 */
export const computeSync = (args: {
  slave: DeckTimeline;
  slaveGrid: BeatGrid;
  master: DeckTimeline;
  masterGrid: BeatGrid;
  atMs: number;
}): { pitchPercent: number; positionSec: number } => {
  const { slave, slaveGrid, master, masterGrid, atMs } = args;
  const masterBpm = masterGrid.bpm * deckRate(master);
  const { rate, multiplier } = matchTempo(slaveGrid.bpm, masterBpm);
  const pitchPercent = (rate - 1) * 100;
  const slavePosition = deckPositionAt(slave, atMs);

  if (slave.status !== "playing" || master.status !== "playing") {
    return { pitchPercent, positionSec: slavePosition };
  }

  const effectiveSlaveGrid = { bpm: slaveGrid.bpm * multiplier, firstBeatSec: slaveGrid.firstBeatSec };
  const delta = wrapPhaseDelta(
    beatPhase(deckPositionAt(master, atMs), masterGrid) - beatPhase(slavePosition, effectiveSlaveGrid)
  );
  let positionSec = slavePosition + delta * beatLengthSec(effectiveSlaveGrid.bpm);
  if (positionSec < 0) positionSec += beatLengthSec(effectiveSlaveGrid.bpm);
  return { pitchPercent, positionSec };
};

/**
 * Quantized start: the earliest server time >= atMs at which the master's beat
 * phase equals the slave's phase at `slavePositionSec`, so a deck started from
 * a cue lands on the master's beat.
 */
export const quantizedStartTime = (args: {
  slavePositionSec: number;
  slaveGrid: BeatGrid;
  master: DeckTimeline;
  masterGrid: BeatGrid;
  atMs: number;
}): number => {
  const { slavePositionSec, slaveGrid, master, masterGrid, atMs } = args;
  if (master.status !== "playing") return atMs;
  const masterBpm = masterGrid.bpm * deckRate(master);
  const { multiplier } = matchTempo(slaveGrid.bpm, masterBpm);
  const slavePhase = beatPhase(slavePositionSec, {
    bpm: slaveGrid.bpm * multiplier,
    firstBeatSec: slaveGrid.firstBeatSec,
  });
  const masterPhase = beatPhase(deckPositionAt(master, atMs), masterGrid);
  const waitBeats = (((slavePhase - masterPhase) % 1) + 1) % 1;
  return atMs + waitBeats * (60 / masterBpm) * 1000;
};

/**
 * Quantized jump: move to `targetSec` while keeping the current beat phase, so
 * a hot cue or beat jump pressed mid-beat stays on the groove.
 */
export const phaseKeepingJump = (currentSec: number, targetSec: number, grid: BeatGrid): number => {
  const delta = wrapPhaseDelta(beatPhase(currentSec, grid) - beatPhase(targetSec, grid));
  return Math.max(0, targetSec + delta * beatLengthSec(grid.bpm));
};
