import type { LibrarySearchResponse, LibraryTrack, TrackType } from "@beatsync/shared";
import { compact } from "@/sources/http";
import type { MusicProviderManager } from "@/managers/MusicProviderManager";
import { MUSIC_PROVIDER_MANAGER } from "@/managers/MusicProviderManager";
import type { MusicSourceAdapter, PageOptions, ResolvedTrack } from "@/sources/types";
import { SourceInputError, UpstreamError } from "@/sources/types";

export function mapProviderTrack(t: TrackType): LibraryTrack {
  return compact<LibraryTrack>({
    sourceId: "provider",
    trackId: String(t.id),
    title: t.version ? `${t.title} (${t.version})` : t.title,
    artist: t.performer.name,
    artworkUrl: t.album.image.large || t.album.image.small,
    durationSec: t.duration > 0 ? t.duration : undefined,
    genre: t.album.genre?.name,
    releaseDate: t.album.release_date_original,
  });
}

/** Wraps the legacy MusicProviderManager (still used by SEARCH_MUSIC / STREAM_MUSIC) */
export class ProviderAdapter implements MusicSourceAdapter {
  readonly info = {
    id: "provider",
    name: "Music provider",
    description: "Tracks from the configured external music provider",
    capabilities: { search: true, browse: false },
    genres: [] as string[],
  };

  constructor(
    private readonly manager: Pick<MusicProviderManager, "search" | "stream"> = MUSIC_PROVIDER_MANAGER,
    private readonly env: Record<string, string | undefined> = process.env
  ) {}

  isEnabled(): boolean {
    return Boolean(this.env.PROVIDER_URL);
  }

  async search(query: string, { offset, limit }: PageOptions): Promise<LibrarySearchResponse> {
    let result: Awaited<ReturnType<MusicProviderManager["search"]>>;
    try {
      result = await this.manager.search(query, offset);
    } catch (error) {
      throw new UpstreamError(error instanceof Error ? error.message : String(error), undefined, { cause: error });
    }
    const { items: raw, total } = result.data.tracks;
    const items = raw.slice(0, limit).map(mapProviderTrack);
    const next = offset + items.length;
    return { items, nextOffset: items.length > 0 && next < total && next <= 1000 ? next : null };
  }

  async resolve(trackId: string): Promise<ResolvedTrack> {
    if (!/^\d{1,15}$/.test(trackId)) throw new SourceInputError(`Invalid provider track id: ${trackId}`);
    let response: Awaited<ReturnType<MusicProviderManager["stream"]>>;
    try {
      response = await this.manager.stream(Number(trackId));
    } catch (error) {
      throw new UpstreamError(error instanceof Error ? error.message : String(error), undefined, { cause: error });
    }
    if (!response.success) throw new UpstreamError(`Provider could not stream track ${trackId}`);
    return { url: response.data.url };
  }
}
