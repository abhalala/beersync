import type { LibrarySearchResponse, LibraryTrack } from "@beatsync/shared";
import { z } from "zod";
import { compact, defaultFetch, fetchJson } from "@/sources/http";
import type { FetchFn } from "@/sources/safeFetch";
import type { BrowseOptions, MusicSourceAdapter, PageOptions, ResolvedTrack } from "@/sources/types";
import { SourceInputError, UpstreamError } from "@/sources/types";

// Jamendo tags are lowercase single words
export const JAMENDO_GENRES = [
  "electronic",
  "house",
  "techno",
  "trance",
  "dubstep",
  "drumnbass",
  "breakbeat",
  "edm",
  "dance",
  "triphop",
  "chillout",
  "lounge",
  "ambient",
  "downtempo",
  "hiphop",
  "funk",
  "disco",
  "pop",
];

const str = z.string().nullish().catch(undefined);

const JamendoTrackSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().min(1),
  duration: z.coerce.number().nullish().catch(undefined),
  artist_name: str,
  album_image: str,
  image: str,
  audio: str,
  releasedate: str,
  shareurl: str,
  license_ccurl: str,
  musicinfo: z
    .looseObject({
      tags: z
        .looseObject({ genres: z.array(z.string()).nullish().catch(undefined) })
        .nullish()
        .catch(undefined),
    })
    .nullish()
    .catch(undefined),
});

const JamendoListSchema = z.looseObject({
  headers: z.looseObject({ status: z.string().optional(), error_message: str }).optional(),
  results: z.array(z.unknown()),
});

/** "http://creativecommons.org/licenses/by-nc-sa/3.0/" -> "CC BY-NC-SA 3.0" */
export function describeCcLicense(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const match = /creativecommons\.org\/licenses\/([a-z-]+)\/(\d(?:\.\d)?)/i.exec(url);
  if (!match) return undefined;
  return `CC ${match[1].toUpperCase()} ${match[2]}`;
}

export function mapJamendoTrack(raw: unknown): (LibraryTrack & { audioUrl?: string }) | null {
  const parsed = JamendoTrackSchema.safeParse(raw);
  if (!parsed.success) return null;
  const t = parsed.data;
  const license = describeCcLicense(t.license_ccurl);
  const genre = t.musicinfo?.tags?.genres?.[0];
  return compact({
    sourceId: "jamendo",
    trackId: t.id,
    title: t.name,
    artist: t.artist_name ?? undefined,
    artworkUrl: t.album_image ?? t.image ?? undefined,
    durationSec: t.duration && t.duration > 0 ? t.duration : undefined,
    genre: genre ?? undefined,
    releaseDate: t.releasedate ?? undefined,
    // Attribution for CC-licensed music
    label: license ? `${license} · Jamendo` : "Jamendo",
    permalink: t.shareurl ?? undefined,
    audioUrl: t.audio ?? undefined,
  });
}

export interface JamendoAdapterOptions {
  fetchImpl?: FetchFn;
  env?: Record<string, string | undefined>;
}

export class JamendoAdapter implements MusicSourceAdapter {
  readonly info = {
    id: "jamendo",
    name: "Jamendo",
    description: "Creative Commons licensed independent music",
    capabilities: { search: true, browse: true },
    genres: JAMENDO_GENRES,
  };

  private readonly fetchImpl: FetchFn;
  private readonly env: Record<string, string | undefined>;

  constructor(options: JamendoAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.env = options.env ?? process.env;
  }

  isEnabled(): boolean {
    return Boolean(this.env.JAMENDO_CLIENT_ID);
  }

  private async query(params: Record<string, string | number | undefined>) {
    const url = new URL(`${this.env.JAMENDO_API_URL ?? "https://api.jamendo.com/v3.0"}/tracks/`);
    url.searchParams.set("client_id", this.env.JAMENDO_CLIENT_ID ?? "");
    url.searchParams.set("format", "json");
    url.searchParams.set("audioformat", "mp32");
    url.searchParams.set("include", "musicinfo licenses");
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const data = await fetchJson(url.toString(), this.fetchImpl);
    const parsed = JamendoListSchema.safeParse(data);
    if (!parsed.success) throw new UpstreamError("Unexpected Jamendo response shape");
    if (parsed.data.headers?.status && parsed.data.headers.status !== "success") {
      throw new UpstreamError(`Jamendo error: ${parsed.data.headers.error_message ?? parsed.data.headers.status}`);
    }
    return parsed.data.results.map(mapJamendoTrack).filter((t) => t !== null);
  }

  private page(tracks: (LibraryTrack & { audioUrl?: string })[], offset: number, limit: number): LibrarySearchResponse {
    const items = tracks.map(({ audioUrl: _audioUrl, ...track }) => track);
    return { items, nextOffset: tracks.length >= limit ? offset + limit : null };
  }

  async search(query: string, { offset, limit }: PageOptions): Promise<LibrarySearchResponse> {
    const tracks = await this.query({ search: query, offset, limit });
    return this.page(tracks, offset, limit);
  }

  async browse({ genre, offset, limit }: BrowseOptions): Promise<LibrarySearchResponse> {
    const tracks = await this.query({ tags: genre, order: "popularity_week", offset, limit });
    return this.page(tracks, offset, limit);
  }

  async resolve(trackId: string): Promise<ResolvedTrack> {
    if (!/^\d{1,20}$/.test(trackId)) throw new SourceInputError(`Invalid Jamendo track id: ${trackId}`);
    const [track] = await this.query({ id: trackId, limit: 1 });
    if (!track?.audioUrl) throw new UpstreamError(`Jamendo track ${trackId} has no stream URL`);
    return { url: track.audioUrl, contentType: "audio/mpeg" };
  }
}
