import type { LibrarySearchResponse, LibrarySourceInfo } from "@beatsync/shared";

export interface PageOptions {
  offset: number;
  limit: number;
}

export interface BrowseOptions extends PageOptions {
  genre?: string;
}

export interface ResolvedTrack {
  /** Where the audio bytes can be downloaded from */
  url: string;
  /** Content-type hint when the upstream serves application/octet-stream */
  contentType?: string;
  /** Extra headers the download needs (auth etc.) */
  headers?: Record<string, string>;
}

/** A music library the DJ console can search/browse and import from */
export interface MusicSourceAdapter {
  info: LibrarySourceInfo;
  isEnabled(): boolean;
  search(query: string, opts: PageOptions): Promise<LibrarySearchResponse>;
  browse?(opts: BrowseOptions): Promise<LibrarySearchResponse>;
  resolve(trackId: string): Promise<ResolvedTrack>;
}

/** Upstream API failure (maps to HTTP 502) */
export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "UpstreamError";
  }
}

/** Invalid adapter input such as an unknown track id (maps to HTTP 400) */
export class SourceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceInputError";
  }
}
