import type { LibrarySearchResponse, LibraryTrack } from "@beatsync/shared";
import { z } from "zod";
import { compact, defaultFetch, fetchJson } from "@/sources/http";
import { toCamelot } from "@/sources/musicalKey";
import type { FetchFn } from "@/sources/safeFetch";
import type { BrowseOptions, MusicSourceAdapter, PageOptions, ResolvedTrack } from "@/sources/types";
import { SourceInputError, UpstreamError } from "@/sources/types";

export const AUDIUS_GENRES = [
  "Electronic",
  "House",
  "Deep House",
  "Tech House",
  "Progressive House",
  "Future House",
  "Tropical House",
  "Techno",
  "Trance",
  "Drum & Bass",
  "Jungle",
  "Dubstep",
  "Trap",
  "Future Bass",
  "Hardstyle",
  "Electro",
  "Glitch Hop",
  "Moombahton",
  "Jersey Club",
  "Disco",
  "Downtempo",
  "Ambient",
  "Lo-Fi",
  "Hip-Hop/Rap",
  "R&B/Soul",
  "Dancehall",
  "Pop",
];

const nullableString = z.string().nullish().catch(undefined);
const nullableNumber = z.number().nullish().catch(undefined);

const AudiusTrackSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string().min(1),
  user: z.looseObject({ name: nullableString, handle: nullableString }).nullish().catch(undefined),
  artwork: z
    .looseObject({ "150x150": nullableString, "480x480": nullableString, "1000x1000": nullableString })
    .nullish()
    .catch(undefined),
  duration: nullableNumber,
  genre: nullableString,
  release_date: nullableString,
  permalink: nullableString,
  is_streamable: z.boolean().nullish().catch(undefined),
  bpm: nullableNumber,
  musical_key: nullableString,
});

const AudiusListSchema = z.looseObject({ data: z.array(z.unknown()) });

/** Map one raw Audius track; null for malformed or non-streamable tracks */
export function mapAudiusTrack(raw: unknown): LibraryTrack | null {
  const parsed = AudiusTrackSchema.safeParse(raw);
  if (!parsed.success) return null;
  const t = parsed.data;
  if (t.is_streamable === false) return null;

  const artworkUrl = t.artwork?.["480x480"] ?? t.artwork?.["150x150"] ?? t.artwork?.["1000x1000"] ?? undefined;
  const permalink = t.permalink
    ? t.permalink.startsWith("http")
      ? t.permalink
      : `https://audius.co${t.permalink.startsWith("/") ? "" : "/"}${t.permalink}`
    : undefined;

  return compact<LibraryTrack>({
    sourceId: "audius",
    trackId: t.id,
    title: t.title,
    artist: t.user?.name ?? t.user?.handle ?? undefined,
    artworkUrl,
    durationSec: t.duration && t.duration > 0 ? t.duration : undefined,
    bpm: t.bpm && t.bpm > 0 ? Math.round(t.bpm * 100) / 100 : undefined,
    key: toCamelot(t.musical_key),
    genre: t.genre ?? undefined,
    releaseDate: t.release_date ?? undefined,
    permalink,
  });
}

function mapList(data: unknown): LibraryTrack[] {
  const parsed = AudiusListSchema.safeParse(data);
  if (!parsed.success) throw new UpstreamError("Unexpected Audius response shape");
  return parsed.data.data.map(mapAudiusTrack).filter((t): t is LibraryTrack => t !== null);
}

export interface AudiusAdapterOptions {
  fetchImpl?: FetchFn;
  apiUrl?: string;
  appName?: string;
  env?: Record<string, string | undefined>;
}

export class AudiusAdapter implements MusicSourceAdapter {
  readonly info = {
    id: "audius",
    name: "Audius",
    description: "Free, artist-uploaded music from the Audius network",
    capabilities: { search: true, browse: true },
    genres: AUDIUS_GENRES,
  };

  private readonly fetchImpl: FetchFn;
  private readonly env: Record<string, string | undefined>;
  private readonly apiUrlOverride?: string;
  private readonly appNameOverride?: string;

  constructor(options: AudiusAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.env = options.env ?? process.env;
    this.apiUrlOverride = options.apiUrl;
    this.appNameOverride = options.appName;
  }

  private get apiUrl(): string {
    return (this.apiUrlOverride ?? this.env.AUDIUS_API_URL ?? "https://api.audius.co/v1").replace(/\/+$/, "");
  }

  private get appName(): string {
    return this.appNameOverride ?? this.env.AUDIUS_APP_NAME ?? "beersync";
  }

  private url(path: string, params: Record<string, string | number | undefined>): string {
    const url = new URL(`${this.apiUrl}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    url.searchParams.set("app_name", this.appName);
    return url.toString();
  }

  isEnabled(): boolean {
    return this.env.AUDIUS_DISABLED !== "1";
  }

  async search(query: string, { offset, limit }: PageOptions): Promise<LibrarySearchResponse> {
    const data = await fetchJson(this.url("/tracks/search", { query, offset, limit }), this.fetchImpl);
    const parsed = AudiusListSchema.safeParse(data);
    const rawCount = parsed.success ? parsed.data.data.length : 0;
    const items = mapList(data).slice(0, limit);
    return { items, nextOffset: rawCount >= limit ? offset + limit : null };
  }

  async browse({ genre, offset, limit }: BrowseOptions): Promise<LibrarySearchResponse> {
    // Trending returns a fixed-size list and ignores paging, so page locally
    const data = await fetchJson(this.url("/tracks/trending", { genre, time: "week" }), this.fetchImpl);
    const all = mapList(data);
    const items = all.slice(offset, offset + limit);
    return { items, nextOffset: offset + limit < all.length ? offset + limit : null };
  }

  resolve(trackId: string): Promise<ResolvedTrack> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(trackId)) {
      return Promise.reject(new SourceInputError(`Invalid Audius track id: ${trackId}`));
    }
    // The stream endpoint 302s to a content node serving the mp3
    return Promise.resolve({
      url: this.url(`/tracks/${encodeURIComponent(trackId)}/stream`, {}),
      contentType: "audio/mpeg",
    });
  }
}
