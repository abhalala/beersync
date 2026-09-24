import type { LibraryTrack, TrackMeta } from "@beatsync/shared";
import { TrackMetaSchema } from "@beatsync/shared";
import { createHash } from "node:crypto";
import { toCamelot } from "@/sources/musicalKey";

/** TrackMeta.sourceTrackId is capped at 200 chars; long ids (URLs) are hashed so de-dupe still works */
export function normalizeSourceTrackId(trackId: string): string {
  if (trackId.length <= 200) return trackId;
  return `sha256:${createHash("sha256").update(trackId).digest("hex")}`;
}

const clip = (s: string | undefined, max: number) => (s ? s.slice(0, max) : undefined);
const inRange = (n: number | undefined, min: number, max: number) =>
  n !== undefined && Number.isFinite(n) && n >= min && n <= max ? n : undefined;

/** Client-supplied library metadata -> TrackMeta that satisfies the shared schema */
export function buildTrackMeta(track: LibraryTrack): TrackMeta {
  const artworkUrl = track.artworkUrl && /^https?:\/\//i.test(track.artworkUrl) ? track.artworkUrl : undefined;
  const meta: TrackMeta = {
    title: clip(track.title, 300),
    artist: clip(track.artist, 300),
    artworkUrl: artworkUrl && artworkUrl.length <= 2000 ? artworkUrl : undefined,
    genre: clip(track.genre, 100),
    durationSec: inRange(track.durationSec, Number.MIN_VALUE, 24 * 3600),
    bpm: inRange(track.bpm, 40, 250),
    key: toCamelot(track.key),
    sourceId: clip(track.sourceId, 40),
    sourceTrackId: normalizeSourceTrackId(track.trackId),
  };
  const cleaned = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));
  return TrackMetaSchema.parse(cleaned);
}
