export type StorageBody = ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array;

/**
 * Where room media (uploaded / imported audio) lives.
 * Keys always look like `room-<roomId>/<fileName>` (see ./keys.ts).
 */
export interface StorageDriver {
  kind: "r2" | "local";
  /** Store an object and return its browser-reachable URL */
  putObject(
    key: string,
    body: StorageBody,
    contentType: string,
    contentLength?: number
  ): Promise<{ publicUrl: string }>;
  /** Browser-reachable URL for a key (no existence check) */
  publicUrl(key: string): string;
  /** Delete every object under a prefix; resolves to the number deleted */
  deletePrefix(prefix: string): Promise<number>;
  /** A URL the browser can PUT the file to directly, plus the resulting public URL */
  createUploadTarget(key: string, contentType: string): Promise<{ uploadUrl: string; publicUrl: string }>;
}
