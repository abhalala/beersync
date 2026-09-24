/**
 * Media key validation. Keys are `room-<roomId>/<fileName>`; anything else is
 * rejected so a key can never escape the room's folder (local driver) or touch
 * unrelated objects (R2 driver).
 */

const ROOM_SEGMENT = /^room-[A-Za-z0-9_-]{1,64}$/;
const MAX_KEY_LENGTH = 1024;

export function isValidRoomSegment(segment: string): boolean {
  return ROOM_SEGMENT.test(segment);
}

export function isValidMediaKey(key: string): boolean {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  if (key.includes("\\") || key.includes("\0") || key.startsWith("/")) return false;
  // Windows drive letters / URL schemes
  if (/^[A-Za-z]:/.test(key)) return false;

  const parts = key.split("/");
  if (parts.length !== 2) return false;
  const [room, fileName] = parts;
  if (!isValidRoomSegment(room)) return false;
  if (!fileName || fileName === "." || fileName === ".." || fileName.includes("..")) return false;
  // Control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(fileName)) return false;
  return true;
}

export function assertValidMediaKey(key: string): void {
  if (!isValidMediaKey(key)) {
    throw new Error(`Invalid media key: ${JSON.stringify(key)}`);
  }
}

/** Split a validated key into its roomId and fileName */
export function splitMediaKey(key: string): { roomId: string; fileName: string } {
  assertValidMediaKey(key);
  const [room, fileName] = key.split("/");
  return { roomId: room.slice("room-".length), fileName };
}

/** Accepts `room-<id>` or `room-<id>/` and returns the normalized `room-<id>/` */
export function normalizeRoomPrefix(prefix: string): string {
  const trimmed = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  if (!isValidRoomSegment(trimmed)) {
    throw new Error(`Invalid media prefix: ${JSON.stringify(prefix)} (expected room-<id>)`);
  }
  return `${trimmed}/`;
}

/** Encode a key for use in a URL path, one segment at a time */
export function encodeKeyPath(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** Decode a URL path (without leading slash) back to a key; null if malformed */
export function decodeKeyPath(path: string): string | null {
  try {
    return path.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
  aif: "audio/aiff",
  aiff: "audio/aiff",
};

export function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export const AUDIO_EXTENSIONS = new Set(Object.keys(EXTENSION_CONTENT_TYPES));

/** Pick a file extension for a content type (falls back to `fallback`) */
export function extensionForContentType(contentType: string, fallback = "mp3"): string {
  const type = contentType.split(";")[0].trim().toLowerCase();
  switch (type) {
    case "audio/mpeg":
    case "audio/mp3":
    case "audio/mpeg3":
      return "mp3";
    case "audio/mp4":
    case "audio/x-m4a":
    case "audio/m4a":
      return "m4a";
    case "audio/aac":
    case "audio/aacp":
      return "aac";
    case "audio/wav":
    case "audio/x-wav":
    case "audio/wave":
    case "audio/vnd.wave":
      return "wav";
    case "audio/flac":
    case "audio/x-flac":
      return "flac";
    case "audio/ogg":
    case "application/ogg":
      return "ogg";
    case "audio/opus":
      return "opus";
    case "audio/webm":
    case "video/webm":
      return "webm";
    case "audio/aiff":
    case "audio/x-aiff":
      return "aiff";
    default:
      return fallback;
  }
}

/** True for content types we accept as uploadable audio */
export function isUploadableContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const type = contentType.split(";")[0].trim().toLowerCase();
  return type.startsWith("audio/") || type === "video/webm";
}

/**
 * Make a generated file name key-safe: collapses `..` runs (rejected by
 * isValidMediaKey) that can survive sanitize-filename, e.g. "Intro.. (Edit).mp3".
 */
export function toStorageFileName(fileName: string): string {
  return fileName.replace(/\.{2,}/g, ".").replace(/[/\\]/g, "-");
}
