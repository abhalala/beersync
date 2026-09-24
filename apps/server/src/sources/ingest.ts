import type { LibraryTrack } from "@beatsync/shared";
import { generateAudioFileName } from "@/lib/r2";
import type { FetchFn, LookupFn } from "@/sources/safeFetch";
import { SAFE_FETCH_DEFAULTS, limitedBody, safeFetch } from "@/sources/safeFetch";
import type { ResolvedTrack } from "@/sources/types";
import { UpstreamError } from "@/sources/types";
import { AUDIO_EXTENSIONS, contentTypeForKey, extensionForContentType, toStorageFileName } from "@/storage/keys";
import type { StorageDriver } from "@/storage/types";

export const IMPORT_MAX_BYTES = SAFE_FETCH_DEFAULTS.maxBytes;

function extensionOf(url: string): string | undefined {
  try {
    const last = new URL(url).pathname.split("/").pop() ?? "";
    const dot = last.lastIndexOf(".");
    if (dot <= 0) return undefined;
    const ext = last.slice(dot + 1).toLowerCase();
    return AUDIO_EXTENSIONS.has(ext) ? ext : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Decide whether a download is audio. Returns the content type to store with,
 * or null to reject. octet-stream is accepted only when the URL has an audio
 * extension or the (trusted) adapter supplied an audio content-type hint.
 */
export function acceptAudioContentType(header: string | null, finalUrl: string, hint?: string): string | null {
  const type = (header ?? "").split(";")[0].trim().toLowerCase();
  if (type.startsWith("audio/") || type === "application/ogg" || type === "video/webm") return type;

  if (type === "" || type === "application/octet-stream" || type === "binary/octet-stream") {
    const ext = extensionOf(finalUrl);
    if (ext) return contentTypeForKey(`x.${ext}`);
    if (hint?.toLowerCase().startsWith("audio/")) return hint.toLowerCase();
  }
  return null;
}

export interface DownloadTrackOptions {
  roomId: string;
  track: LibraryTrack;
  resolved: ResolvedTrack;
  storage: StorageDriver;
  fetchImpl?: FetchFn;
  lookup?: LookupFn;
  maxBytes?: number;
}

/** Download a resolved track through the SSRF guard and store it under room-<roomId>/ */
export async function downloadTrackToStorage(options: DownloadTrackOptions): Promise<{ url: string }> {
  const { roomId, track, resolved, storage } = options;
  const maxBytes = options.maxBytes ?? IMPORT_MAX_BYTES;

  const { response, url: finalUrl } = await safeFetch(resolved.url, {
    fetchImpl: options.fetchImpl,
    lookup: options.lookup,
    headers: resolved.headers,
  });

  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new UpstreamError(`Download failed with HTTP ${response.status}`, response.status);
  }

  const contentType = acceptAudioContentType(response.headers.get("content-type"), finalUrl, resolved.contentType);
  if (!contentType) {
    void response.body?.cancel().catch(() => undefined);
    throw new UpstreamError(
      `Not an audio file (content-type: ${response.headers.get("content-type") ?? "none"})`,
      response.status
    );
  }

  const body = limitedBody(response, maxBytes);
  const declared = Number(response.headers.get("content-length") ?? NaN);

  const ext = extensionForContentType(contentType, extensionOf(finalUrl) ?? "mp3");
  const baseName = [track.artist, track.title].filter(Boolean).join(" - ").slice(0, 150) || "track";
  const fileName = toStorageFileName(generateAudioFileName(`${baseName}.${ext}`));
  const key = `room-${roomId}/${fileName}`;

  const { publicUrl } = await storage.putObject(
    key,
    body,
    contentType,
    Number.isFinite(declared) ? declared : undefined
  );
  return { url: publicUrl };
}
