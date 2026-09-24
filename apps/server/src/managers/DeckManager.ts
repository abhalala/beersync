import type {
  BeatGrid,
  DeckCommand,
  DeckId,
  DeckState,
  DjActor,
  DjState,
  HotCue,
  Loop,
  MixerPatch,
  MixerState,
  TempoRange,
  TrackMeta,
} from "@beatsync/shared";
import {
  beatLengthSec,
  computeSync,
  createEmptyDeck,
  DECK_IDS,
  deckPositionAt,
  HOT_CUE_COUNT,
  nearestBeatSec,
  phaseKeepingJump,
  previousBeatSec,
  createDefaultMixer,
  quantizedStartTime,
  TEMPO_RANGES,
  wrapIntoLoop,
} from "@beatsync/shared";

/** Pad colours assigned to new hot cues, in pad order (rekordbox-like palette) */
const HOT_CUE_COLORS = ["#2fd35c", "#f5c542", "#3ccbe2", "#f3a53d", "#e04f5f", "#b45cf2", "#4f7df0", "#e0e0e0"];

/** Smallest loop we allow, in seconds (1/32 beat at 180 BPM is ~10 ms) */
const MIN_LOOP_SEC = 0.01;

export type DeckCommandResult = { ok: true; deck: DeckState; mixer?: MixerState } | { ok: false; error: string };

export interface DeckCommandContext {
  deckId: DeckId;
  command: DeckCommand;
  actor: DjActor;
  isAdmin: boolean;
  /** Server time at which transport changes take effect (already includes scheduling delay) */
  scheduleAtMs: number;
  /** A room track's metadata by URL ({} when it has none); undefined if the track isn't in the room */
  getTrackMeta: (url: string) => TrackMeta | undefined;
}

const gridOf = (meta: TrackMeta | undefined): BeatGrid | null =>
  meta?.bpm !== undefined && meta.firstBeatSec !== undefined
    ? { bpm: meta.bpm, firstBeatSec: meta.firstBeatSec }
    : null;

const clampPosition = (positionSec: number, durationSec: number | undefined) =>
  Math.max(0, durationSec !== undefined ? Math.min(positionSec, durationSec) : positionSec);

/**
 * DeckManager owns a room's shared DJ state: two decks and the mixer.
 *
 * All transport changes produce a new timeline anchor at `scheduleAtMs`, so every
 * device (which computes positions with the shared deckPositionAt) switches at the
 * same moment. Changes that don't move the playhead (hot cue edits, quantize,
 * tempo range) keep the current anchor so clients don't restart audio.
 */
export class DeckManager {
  private decks: Record<DeckId, DeckState> = { A: createEmptyDeck("A"), B: createEmptyDeck("B") };
  private mixer: MixerState = createDefaultMixer();

  getState(): DjState {
    return { decks: DECK_IDS.map((id) => this.decks[id]), mixer: this.mixer };
  }

  getDeck(deckId: DeckId): DeckState {
    return this.decks[deckId];
  }

  getMixer(): MixerState {
    return this.mixer;
  }

  restore(state: DjState): void {
    for (const deck of state.decks) this.decks[deck.deckId] = deck;
    this.mixer = state.mixer;
  }

  private canOperate(deck: DeckState, actor: DjActor, isAdmin: boolean): boolean {
    return !deck.lockedBy || deck.lockedBy.clientId === actor.clientId || isAdmin;
  }

  claimDeck(args: { deckId: DeckId; claim: boolean; actor: DjActor; isAdmin: boolean }): DeckCommandResult {
    const deck = this.decks[args.deckId];
    if (!this.canOperate(deck, args.actor, args.isAdmin)) {
      return { ok: false, error: `Deck ${args.deckId} is claimed by ${deck.lockedBy?.username}` };
    }
    const next: DeckState = {
      ...deck,
      lockedBy: args.claim ? args.actor : null,
      version: deck.version + 1,
      lastActor: args.actor,
    };
    this.decks[args.deckId] = next;
    return { ok: true, deck: next };
  }

  /** Release claims held by a client (e.g. when they leave the room) */
  releaseClaimsOf(clientId: string): DeckState[] {
    const changed: DeckState[] = [];
    for (const id of DECK_IDS) {
      const deck = this.decks[id];
      if (deck.lockedBy?.clientId === clientId) {
        this.decks[id] = { ...deck, lockedBy: null, version: deck.version + 1 };
        changed.push(this.decks[id]);
      }
    }
    return changed;
  }

  /** Eject decks whose track was removed from the room collection */
  ejectTracks(urls: string[]): DeckState[] {
    const removed = new Set(urls);
    const changed: DeckState[] = [];
    for (const id of DECK_IDS) {
      const deck = this.decks[id];
      if (deck.trackUrl && removed.has(deck.trackUrl)) {
        this.decks[id] = {
          ...createEmptyDeck(id),
          pitchPercent: deck.pitchPercent,
          tempoRange: deck.tempoRange,
          quantize: deck.quantize,
          lockedBy: deck.lockedBy,
          version: deck.version + 1,
        };
        changed.push(this.decks[id]);
      }
    }
    return changed;
  }

  applyMixerPatch(patch: MixerPatch, actor: DjActor): MixerState {
    const { channels } = this.mixer;
    this.mixer = {
      ...this.mixer,
      ...(patch.crossfader !== undefined ? { crossfader: patch.crossfader } : {}),
      ...(patch.crossfaderCurve !== undefined ? { crossfaderCurve: patch.crossfaderCurve } : {}),
      ...(patch.masterDeck !== undefined ? { masterDeck: patch.masterDeck } : {}),
      channels: {
        A: { ...channels.A, ...patch.channels?.A },
        B: { ...channels.B, ...patch.channels?.B },
      },
      version: this.mixer.version + 1,
      lastActor: actor,
    };
    return this.mixer;
  }

  applyCommand(ctx: DeckCommandContext): DeckCommandResult {
    const { deckId, command, actor, isAdmin, getTrackMeta } = ctx;
    const deck = this.decks[deckId];
    if (!this.canOperate(deck, actor, isAdmin)) {
      return { ok: false, error: `Deck ${deckId} is claimed by ${deck.lockedBy?.username}` };
    }

    // Anchors only move forward in time, even if the scheduling delay shrank
    const at = Math.max(ctx.scheduleAtMs, deck.anchorServerTime);
    const meta = deck.trackUrl ? getTrackMeta(deck.trackUrl) : undefined;
    const duration = meta?.durationSec;
    const grid = gridOf(meta);
    const now = () => deckPositionAt(deck, at, duration);

    const commit = (patch: Partial<DeckState>, mixer?: MixerState): DeckCommandResult => {
      const next: DeckState = { ...deck, ...patch, version: deck.version + 1, lastActor: actor };
      this.decks[deckId] = next;
      return { ok: true, deck: next, mixer };
    };
    /** Re-anchor the timeline at `at` (or a later start time) */
    const anchor = (positionSec: number, patch: Partial<DeckState> = {}, anchorAt = at) => {
      const loop = "loop" in patch ? (patch.loop ?? null) : deck.loop;
      return commit({
        anchorServerTime: anchorAt,
        anchorPositionSec: clampPosition(wrapIntoLoop(positionSec, loop), duration),
        ...patch,
      });
    };

    if (command.type === "LOAD") {
      if (deck.status === "playing") return { ok: false, error: `Pause deck ${deckId} before loading a new track` };
      if (!getTrackMeta(command.trackUrl)) {
        return { ok: false, error: "That track is not in this room's collection" };
      }
      return commit({
        trackUrl: command.trackUrl,
        status: "paused",
        anchorServerTime: at,
        anchorPositionSec: 0,
        cuePointSec: 0,
        hotCues: Array.from({ length: HOT_CUE_COUNT }, () => null),
        loop: null,
      });
    }

    if (command.type === "SET_QUANTIZE") return commit({ quantize: command.enabled });

    if (command.type === "SET_TEMPO_RANGE") {
      const pitchPercent = Math.max(-command.range, Math.min(command.range, deck.pitchPercent));
      if (pitchPercent === deck.pitchPercent || deck.status !== "playing") {
        return commit({ tempoRange: command.range, pitchPercent });
      }
      return anchor(now(), { tempoRange: command.range, pitchPercent });
    }

    if (command.type === "SET_PITCH") {
      const pitchPercent = Math.max(-deck.tempoRange, Math.min(deck.tempoRange, command.pitchPercent));
      if (deck.status !== "playing") return commit({ pitchPercent });
      return anchor(now(), { pitchPercent });
    }

    // Everything below needs a loaded track
    if (deck.status === "empty" || !deck.trackUrl) return { ok: false, error: `Load a track on deck ${deckId} first` };

    switch (command.type) {
      case "EJECT": {
        if (deck.status === "playing") return { ok: false, error: `Pause deck ${deckId} before ejecting` };
        return commit({
          ...createEmptyDeck(deckId),
          pitchPercent: deck.pitchPercent,
          tempoRange: deck.tempoRange,
          quantize: deck.quantize,
          lockedBy: deck.lockedBy,
        });
      }

      case "PLAY": {
        if (deck.status === "playing") return commit({});
        const startPosition = deck.anchorPositionSec;
        if (duration !== undefined && startPosition >= duration - 0.05) {
          return { ok: false, error: "The playhead is at the end of the track" };
        }
        const startAt = this.quantizedStart(deckId, deck.quantize, startPosition, grid, at, getTrackMeta);
        const result = anchor(startPosition, { status: "playing" }, startAt);
        return this.withAutoMaster(deckId, actor, result);
      }

      case "PAUSE": {
        if (deck.status !== "playing") return commit({});
        return anchor(now(), { status: "paused" });
      }

      case "CUE": {
        if (deck.status === "playing") {
          return anchor(deck.cuePointSec, { status: "paused", loop: null });
        }
        const position =
          deck.quantize && grid ? Math.max(0, nearestBeatSec(deck.anchorPositionSec, grid)) : deck.anchorPositionSec;
        return anchor(position, { cuePointSec: clampPosition(position, duration) });
      }

      case "SEEK": {
        const target = clampPosition(command.positionSec, duration);
        const leavesLoop = deck.loop && (target < deck.loop.startSec || target >= deck.loop.endSec);
        return anchor(target, leavesLoop ? { loop: null } : {});
      }

      case "NUDGE": {
        const target = Math.max(0, now() + command.deltaSec);
        return anchor(target);
      }

      case "SET_HOT_CUE": {
        const raw = deck.status === "playing" ? now() : deck.anchorPositionSec;
        const positionSec = clampPosition(
          deck.quantize && grid ? Math.max(0, nearestBeatSec(raw, grid)) : raw,
          duration
        );
        return commit({
          hotCues: this.withHotCue(deck, command.index, { positionSec, color: HOT_CUE_COLORS[command.index] }),
        });
      }

      case "DELETE_HOT_CUE":
        return commit({ hotCues: this.withHotCue(deck, command.index, null) });

      case "JUMP_HOT_CUE": {
        const cue = deck.hotCues[command.index];
        if (!cue) {
          // Pressing an empty pad sets a cue there, like a CDJ
          return this.applyCommand({ ...ctx, command: { type: "SET_HOT_CUE", index: command.index } });
        }
        if (deck.status === "playing") {
          const target = deck.quantize && grid ? phaseKeepingJump(now(), cue.positionSec, grid) : cue.positionSec;
          const leavesLoop = deck.loop && (target < deck.loop.startSec || target >= deck.loop.endSec);
          return anchor(target, leavesLoop ? { loop: null } : {});
        }
        // From pause, a hot cue launches playback (CDJ behaviour), on the master's beat when quantized
        const startAt = this.quantizedStart(deckId, deck.quantize, cue.positionSec, grid, at, getTrackMeta);
        const result = anchor(cue.positionSec, { status: "playing", loop: null }, startAt);
        return this.withAutoMaster(deckId, actor, result);
      }

      case "LOOP_AUTO": {
        const effectiveGrid = grid ?? { bpm: 120, firstBeatSec: 0 };
        const position = deck.status === "playing" ? now() : deck.anchorPositionSec;
        const start = Math.max(0, deck.quantize ? previousBeatSec(position, effectiveGrid) : position);
        const loop: Loop = {
          startSec: start,
          endSec: start + Math.max(MIN_LOOP_SEC, command.beats * beatLengthSec(effectiveGrid.bpm)),
        };
        if (duration !== undefined && loop.endSec > duration)
          return { ok: false, error: "Not enough track left for that loop" };
        return deck.status === "playing" ? anchor(position, { loop }) : commit({ loop });
      }

      case "LOOP_EXIT": {
        if (!deck.loop) return commit({});
        return deck.status === "playing" ? anchor(now(), { loop: null }) : commit({ loop: null });
      }

      case "LOOP_RESIZE": {
        if (!deck.loop) return { ok: false, error: "No active loop to resize" };
        const length = Math.max(MIN_LOOP_SEC, (deck.loop.endSec - deck.loop.startSec) * command.factor);
        const loop: Loop = { startSec: deck.loop.startSec, endSec: deck.loop.startSec + length };
        if (duration !== undefined && loop.endSec > duration)
          return { ok: false, error: "Not enough track left for that loop" };
        return deck.status === "playing" ? anchor(now(), { loop }) : commit({ loop });
      }

      case "BEAT_JUMP": {
        const beatLen = beatLengthSec((grid ?? { bpm: 120 }).bpm);
        const delta = command.beats * beatLen;
        const position = deck.status === "playing" ? now() : deck.anchorPositionSec;
        const target = clampPosition(position + delta, duration);
        // A jump inside a loop moves the loop with it (loop move)
        const loop = deck.loop
          ? {
              startSec: Math.max(0, deck.loop.startSec + delta),
              endSec: Math.max(MIN_LOOP_SEC, deck.loop.endSec + delta),
            }
          : null;
        return anchor(target, { loop });
      }

      case "SYNC": {
        const masterId = this.pickSyncMaster(deckId, getTrackMeta);
        if (!masterId) return { ok: false, error: "Nothing to sync to: load and analyze a track on the other deck" };
        const master = this.decks[masterId];
        const masterGrid = gridOf(getTrackMeta(master.trackUrl!));
        if (!grid || !masterGrid)
          return { ok: false, error: "Both tracks need a beat grid before syncing (analysis pending)" };
        const { pitchPercent, positionSec } = computeSync({
          slave: deck,
          slaveGrid: grid,
          master,
          masterGrid,
          atMs: at,
        });
        const tempoRange = this.rangeFor(pitchPercent, deck.tempoRange);
        if (deck.status !== "playing") return commit({ pitchPercent, tempoRange });
        return anchor(positionSec, { pitchPercent, tempoRange });
      }
    }
  }

  private withHotCue(deck: DeckState, index: number, cue: HotCue | null): (HotCue | null)[] {
    const hotCues = [...deck.hotCues];
    hotCues[index] = cue;
    return hotCues;
  }

  /** Smallest tempo range that fits the pitch (SYNC can need more than the current range) */
  private rangeFor(pitchPercent: number, current: TempoRange): TempoRange {
    if (Math.abs(pitchPercent) <= current) return current;
    return TEMPO_RANGES.find((range) => Math.abs(pitchPercent) <= range) ?? 50;
  }

  /** Master for SYNC: the mixer's master deck if it's another loaded deck, else any other loaded deck */
  private pickSyncMaster(deckId: DeckId, getTrackMeta: (url: string) => TrackMeta | undefined): DeckId | null {
    const candidates = DECK_IDS.filter(
      (id) => id !== deckId && this.decks[id].trackUrl && getTrackMeta(this.decks[id].trackUrl)
    );
    if (this.mixer.masterDeck && candidates.includes(this.mixer.masterDeck)) return this.mixer.masterDeck;
    return candidates.find((id) => this.decks[id].status === "playing") ?? candidates[0] ?? null;
  }

  private quantizedStart(
    deckId: DeckId,
    quantize: boolean,
    positionSec: number,
    grid: BeatGrid | null,
    at: number,
    getTrackMeta: (url: string) => TrackMeta | undefined
  ): number {
    if (!quantize || !grid) return at;
    const masterId = this.pickSyncMaster(deckId, getTrackMeta);
    if (!masterId) return at;
    const master = this.decks[masterId];
    const masterGrid = gridOf(getTrackMeta(master.trackUrl!));
    if (!masterGrid || master.status !== "playing") return at;
    return quantizedStartTime({ slavePositionSec: positionSec, slaveGrid: grid, master, masterGrid, atMs: at });
  }

  /** The first deck to start playing becomes the tempo master if there is no playing master */
  private withAutoMaster(deckId: DeckId, actor: DjActor, result: DeckCommandResult): DeckCommandResult {
    if (!result.ok) return result;
    const master = this.mixer.masterDeck;
    if (master && master !== deckId && this.decks[master].status === "playing") return result;
    if (master === deckId) return result;
    return { ...result, mixer: this.applyMixerPatch({ masterDeck: deckId }, actor) };
  }
}
