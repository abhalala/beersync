import type { LibrarySearchResponse, LibraryTrack } from "@beatsync/shared";
import { AUDIO_EXTENSIONS } from "@/storage/keys";
import type { MusicSourceAdapter, ResolvedTrack } from "@/sources/types";
import { SourceInputError } from "@/sources/types";

const MAX_URL_LENGTH = 2048;

function parseHttpUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Human title from a URL: last path segment without its audio extension, else the host */
export function titleFromUrl(url: URL): string {
  const segment = url.pathname.split("/").filter(Boolean).pop();
  if (segment) {
    let name: string;
    try {
      name = decodeURIComponent(segment);
    } catch {
      name = segment;
    }
    const dot = name.lastIndexOf(".");
    if (dot > 0 && AUDIO_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())) name = name.slice(0, dot);
    name = name.replace(/[_+]+/g, " ").trim();
    if (name) return name.slice(0, 300);
  }
  return url.hostname;
}

/**
 * Direct link import. search() never touches the network (the paste is echoed
 * back as a single result); the SSRF-guarded download happens at import time.
 */
export class UrlAdapter implements MusicSourceAdapter {
  readonly info = {
    id: "url",
    name: "Direct link",
    description: "Paste an http(s) link to an audio file",
    capabilities: { search: true, browse: false },
    genres: [] as string[],
  };

  isEnabled(): boolean {
    return true;
  }

  search(query: string): Promise<LibrarySearchResponse> {
    const url = parseHttpUrl(query);
    if (!url) return Promise.resolve({ items: [], nextOffset: null });
    const item: LibraryTrack = {
      sourceId: "url",
      trackId: url.toString(),
      title: titleFromUrl(url),
      artist: url.hostname,
      permalink: url.toString(),
    };
    return Promise.resolve({ items: [item], nextOffset: null });
  }

  resolve(trackId: string): Promise<ResolvedTrack> {
    const url = parseHttpUrl(trackId);
    if (!url) return Promise.reject(new SourceInputError("Track id must be an http(s) URL"));
    return Promise.resolve({ url: url.toString() });
  }
}
