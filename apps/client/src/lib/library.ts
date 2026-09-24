import { getApiUrl } from "@/lib/urls";
import {
  LibrarySearchResponseSchema,
  LibrarySourcesResponseSchema,
  type LibrarySearchResponse,
  type LibrarySourceInfo,
} from "@beatsync/shared";

// Music library sources (server-side adapters: Audius, Jamendo, direct URL, ...)

const getJson = async (path: string, params: Record<string, string | number | undefined> = {}) => {
  const url = new URL(path, getApiUrl());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      message = (JSON.parse(body) as { error?: string; message?: string }).error ?? message;
    } catch {
      // Plain-text error
    }
    throw new Error(message || `Request failed (${response.status})`);
  }
  return (await response.json()) as unknown;
};

export const fetchLibrarySources = async (): Promise<LibrarySourceInfo[]> =>
  LibrarySourcesResponseSchema.parse(await getJson("/library/sources")).sources;

export const searchLibrary = async (args: {
  source: string;
  query: string;
  offset?: number;
}): Promise<LibrarySearchResponse> =>
  LibrarySearchResponseSchema.parse(
    await getJson("/library/search", { source: args.source, q: args.query, offset: args.offset ?? 0, limit: 30 })
  );

export const browseLibrary = async (args: {
  source: string;
  genre?: string;
  offset?: number;
}): Promise<LibrarySearchResponse> =>
  LibrarySearchResponseSchema.parse(
    await getJson("/library/browse", { source: args.source, genre: args.genre, offset: args.offset ?? 0, limit: 30 })
  );
