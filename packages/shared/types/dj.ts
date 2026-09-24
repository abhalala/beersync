import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Beersync DJ console: shared deck + mixer state.
//
// Decks are replicated as full snapshots with a timeline anchor. Every device
// computes the playhead with the same pure function (see ../dj/timeline.ts):
//
//   position(t) = anchorPositionSec + (t - anchorServerTime) / 1000 * rate
//
// Transport changes (play, pause, seek, cue, loops, tempo, sync, nudge) create
// a new anchor at a *scheduled* server time, so every device switches at the
// same moment. Mixer changes (EQ, filter, faders, crossfader) apply on receipt.
// ─────────────────────────────────────────────────────────────────────────────

export const DeckIdSchema = z.enum(["A", "B"]);
export type DeckId = z.infer<typeof DeckIdSchema>;
export const DECK_IDS: readonly DeckId[] = DeckIdSchema.options;

export const HOT_CUE_COUNT = 8;
export const TEMPO_RANGES = [6, 10, 16, 50] as const;
export const TempoRangeSchema = z.union([z.literal(6), z.literal(10), z.literal(16), z.literal(50)]);
export type TempoRange = z.infer<typeof TempoRangeSchema>;

export const HotCueSchema = z.object({
  positionSec: z.number().nonnegative(),
  color: z.string().max(16).optional(),
  label: z.string().max(40).optional(),
});
export type HotCue = z.infer<typeof HotCueSchema>;

export const LoopSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
});
export type Loop = z.infer<typeof LoopSchema>;

export const DjActorSchema = z.object({
  clientId: z.string(),
  username: z.string(),
});
export type DjActor = z.infer<typeof DjActorSchema>;

export const DeckStatusSchema = z.enum(["empty", "paused", "playing"]);
export type DeckStatus = z.infer<typeof DeckStatusSchema>;

export const DeckStateSchema = z.object({
  deckId: DeckIdSchema,
  /** URL of a track in the room collection (audioSources), or null when empty */
  trackUrl: z.string().nullable(),
  status: DeckStatusSchema,
  /** Server epoch ms at which the playhead is (or will be) at anchorPositionSec */
  anchorServerTime: z.number(),
  anchorPositionSec: z.number(),
  /** Tempo fader, in percent. Playback rate = 1 + pitchPercent / 100 */
  pitchPercent: z.number(),
  tempoRange: TempoRangeSchema,
  cuePointSec: z.number().nonnegative(),
  hotCues: z.array(HotCueSchema.nullable()).length(HOT_CUE_COUNT),
  /** Active loop: the playhead wraps from endSec back to startSec */
  loop: LoopSchema.nullable(),
  quantize: z.boolean(),
  /** Monotonic per deck; clients drop snapshots older than what they have */
  version: z.number().int().nonnegative(),
  lastActor: DjActorSchema.nullable(),
  /** A DJ who claimed this deck; only they (or an admin) can operate it */
  lockedBy: DjActorSchema.nullable(),
});
export type DeckState = z.infer<typeof DeckStateSchema>;

export const CrossfaderAssignSchema = z.enum(["A", "THRU", "B"]);
export type CrossfaderAssign = z.infer<typeof CrossfaderAssignSchema>;

export const MixerChannelSchema = z.object({
  /** Input gain in dB */
  trimDb: z.number().min(-12).max(12),
  /** EQ knobs: -1 = kill, 0 = flat, +1 = +6 dB */
  eqHigh: z.number().min(-1).max(1),
  eqMid: z.number().min(-1).max(1),
  eqLow: z.number().min(-1).max(1),
  /** Bipolar filter: < 0 low-pass, > 0 high-pass, 0 = off */
  filter: z.number().min(-1).max(1),
  /** Channel fader, 0..1 */
  fader: z.number().min(0).max(1),
  crossfaderAssign: CrossfaderAssignSchema,
});
export type MixerChannel = z.infer<typeof MixerChannelSchema>;

export const CrossfaderCurveSchema = z.enum(["smooth", "sharp"]);
export type CrossfaderCurve = z.infer<typeof CrossfaderCurveSchema>;

export const MixerStateSchema = z.object({
  channels: z.object({ A: MixerChannelSchema, B: MixerChannelSchema }),
  /** -1 = full A, 0 = centre, +1 = full B */
  crossfader: z.number().min(-1).max(1),
  crossfaderCurve: CrossfaderCurveSchema,
  /** Tempo/phase reference for SYNC */
  masterDeck: DeckIdSchema.nullable(),
  version: z.number().int().nonnegative(),
  lastActor: DjActorSchema.nullable(),
});
export type MixerState = z.infer<typeof MixerStateSchema>;

export const MixerChannelPatchSchema = MixerChannelSchema.partial();
export const MixerPatchSchema = z.object({
  channels: z.object({ A: MixerChannelPatchSchema.optional(), B: MixerChannelPatchSchema.optional() }).optional(),
  crossfader: z.number().min(-1).max(1).optional(),
  crossfaderCurve: CrossfaderCurveSchema.optional(),
  masterDeck: DeckIdSchema.nullable().optional(),
});
export type MixerPatch = z.infer<typeof MixerPatchSchema>;

export const DjStateSchema = z.object({
  decks: z.array(DeckStateSchema),
  mixer: MixerStateSchema,
});
export type DjState = z.infer<typeof DjStateSchema>;

// ── Track metadata + analysis ────────────────────────────────────────────────

/** Beat grid: a constant-tempo grid anchored at the first downbeat */
export const BeatGridSchema = z.object({
  bpm: z.number().min(40).max(250),
  firstBeatSec: z.number(),
});
export type BeatGrid = z.infer<typeof BeatGridSchema>;

export const TrackAnalysisSchema = z.object({
  bpm: z.number().min(40).max(250),
  firstBeatSec: z.number(),
  /** Camelot notation, e.g. "8A" */
  key: z.string().max(4).optional(),
  durationSec: z.number().positive(),
});
export type TrackAnalysis = z.infer<typeof TrackAnalysisSchema>;

export const TrackMetaSchema = z.object({
  title: z.string().max(300).optional(),
  artist: z.string().max(300).optional(),
  artworkUrl: z.string().max(2000).optional(),
  genre: z.string().max(100).optional(),
  durationSec: z.number().positive().optional(),
  bpm: z.number().min(40).max(250).optional(),
  firstBeatSec: z.number().optional(),
  key: z.string().max(4).optional(),
  /** Adapter the track came from ("upload", "audius", ...) */
  sourceId: z.string().max(40).optional(),
  sourceTrackId: z.string().max(200).optional(),
});
export type TrackMeta = z.infer<typeof TrackMetaSchema>;

// ── Deck commands (client -> server) ─────────────────────────────────────────
// Positions are computed server-side from the deck timeline at the scheduled
// execution time, so commands carry intent, not client-side playhead guesses.

export const DeckCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("LOAD"), trackUrl: z.string() }),
  z.object({ type: z.literal("EJECT") }),
  z.object({ type: z.literal("PLAY") }),
  z.object({ type: z.literal("PAUSE") }),
  /** Paused: set the cue point here. Playing: return to the cue point and pause. */
  z.object({ type: z.literal("CUE") }),
  z.object({ type: z.literal("SEEK"), positionSec: z.number().nonnegative() }),
  z.object({ type: z.literal("SET_PITCH"), pitchPercent: z.number().min(-50).max(50) }),
  z.object({ type: z.literal("SET_TEMPO_RANGE"), range: TempoRangeSchema }),
  /** Phase nudge (jog while playing): shift the playhead by deltaSec */
  z.object({ type: z.literal("NUDGE"), deltaSec: z.number().min(-2).max(2) }),
  z.object({
    type: z.literal("SET_HOT_CUE"),
    index: z
      .number()
      .int()
      .min(0)
      .max(HOT_CUE_COUNT - 1),
  }),
  z.object({
    type: z.literal("DELETE_HOT_CUE"),
    index: z
      .number()
      .int()
      .min(0)
      .max(HOT_CUE_COUNT - 1),
  }),
  z.object({
    type: z.literal("JUMP_HOT_CUE"),
    index: z
      .number()
      .int()
      .min(0)
      .max(HOT_CUE_COUNT - 1),
  }),
  z.object({ type: z.literal("LOOP_AUTO"), beats: z.number().positive().max(64) }),
  z.object({ type: z.literal("LOOP_EXIT") }),
  z.object({ type: z.literal("LOOP_RESIZE"), factor: z.union([z.literal(0.5), z.literal(2)]) }),
  z.object({ type: z.literal("BEAT_JUMP"), beats: z.number().min(-64).max(64) }),
  /** Match tempo and beat phase to the master deck */
  z.object({ type: z.literal("SYNC") }),
  z.object({ type: z.literal("SET_QUANTIZE"), enabled: z.boolean() }),
]);
export type DeckCommand = z.infer<typeof DeckCommandSchema>;

// ── Music library (adapters) ─────────────────────────────────────────────────

export const LibraryTrackSchema = z.object({
  sourceId: z.string(),
  trackId: z.string(),
  title: z.string(),
  artist: z.string().optional(),
  artworkUrl: z.string().optional(),
  durationSec: z.number().optional(),
  bpm: z.number().optional(),
  key: z.string().optional(),
  genre: z.string().optional(),
  releaseDate: z.string().optional(),
  label: z.string().optional(),
  permalink: z.string().optional(),
});
export type LibraryTrack = z.infer<typeof LibraryTrackSchema>;

export const LibrarySourceInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  capabilities: z.object({
    search: z.boolean(),
    browse: z.boolean(),
  }),
  /** Browse categories (e.g. genres) this source offers */
  genres: z.array(z.string()).default([]),
});
export type LibrarySourceInfo = z.infer<typeof LibrarySourceInfoSchema>;

export const LibrarySourcesResponseSchema = z.object({
  sources: z.array(LibrarySourceInfoSchema),
});
export type LibrarySourcesResponse = z.infer<typeof LibrarySourcesResponseSchema>;

export const LibrarySearchResponseSchema = z.object({
  items: z.array(LibraryTrackSchema),
  nextOffset: z.number().nullable(),
});
export type LibrarySearchResponse = z.infer<typeof LibrarySearchResponseSchema>;
