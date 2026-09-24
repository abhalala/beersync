import { stat } from "node:fs/promises";
import { corsHeaders } from "@/utils/responses";
import { contentTypeForKey, decodeKeyPath, isUploadableContentType, isValidMediaKey } from "@/storage/keys";
import type { LocalStorageDriver } from "@/storage/local";
import { LOCAL_UPLOAD_MAX_BYTES } from "@/storage/local";
import { BodyTooLargeError, limitStream } from "@/storage/stream";

// Responses are built here (not via utils/responses helpers) so these routes
// stay byte-exact regardless of how other modules are mocked in tests.

const EXPOSED_HEADERS = "Content-Length, Content-Range, Accept-Ranges, Content-Type";

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

/**
 * Parse a single `Range: bytes=...` header against a file size.
 * Returns null when the header is absent/malformed/multi-range (serve the full
 * body) and "unsatisfiable" when it can't be served (416).
 */
export function parseRange(header: string | null, size: number): ByteRange {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  if (startRaw === "" && endRaw === "") return null;

  if (startRaw === "") {
    // Suffix range: last N bytes
    const suffix = Number(endRaw);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startRaw);
  const end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1);
  if (start >= size) return "unsatisfiable";
  if (endRaw !== "" && Number(endRaw) < start) return null;
  return { start, end };
}

/** GET/HEAD /media/<key> for the local driver, with Range support */
export async function serveLocalMedia(req: Request, driver: LocalStorageDriver, keyPath: string): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json({ error: "Method not allowed" }, 405);
  }

  const key = decodeKeyPath(keyPath);
  if (!key || !isValidMediaKey(key)) {
    return json({ error: "Invalid media key" }, 400);
  }

  const filePath = driver.resolvePath(key);
  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return json({ error: "Not found" }, 404);
    size = info.size;
  } catch {
    return json({ error: "Not found" }, 404);
  }

  const baseHeaders: Record<string, string> = {
    ...corsHeaders,
    "Access-Control-Expose-Headers": EXPOSED_HEADERS,
    "Accept-Ranges": "bytes",
    "Content-Type": contentTypeForKey(key),
    // Keys embed a timestamp, so objects are immutable
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  const file = Bun.file(filePath);
  const range = parseRange(req.headers.get("range"), size);
  const isHead = req.method === "HEAD";

  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
    });
  }

  if (range) {
    const length = range.end - range.start + 1;
    return new Response(isHead ? null : file.slice(range.start, range.end + 1), {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(length),
      },
    });
  }

  return new Response(isHead ? null : file, {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}

/** PUT /media-upload/<key>?token=... — the local stand-in for an R2 presigned PUT */
export async function receiveLocalUpload(
  req: Request,
  driver: LocalStorageDriver,
  keyPath: string,
  token: string | null,
  maxBytes = LOCAL_UPLOAD_MAX_BYTES
): Promise<Response> {
  if (req.method !== "PUT") {
    return json({ error: "Method not allowed" }, 405);
  }

  const key = decodeKeyPath(keyPath);
  if (!key || !isValidMediaKey(key)) {
    return json({ error: "Invalid media key" }, 400);
  }

  if (!token || !driver.verifyUploadToken(key, token)) {
    return json({ error: "Upload token is invalid or expired. Request a new upload URL." }, 403);
  }

  const contentType = req.headers.get("content-type");
  if (!isUploadableContentType(contentType)) {
    return json({ error: "Content-Type must be audio/* or video/webm" }, 415);
  }

  const declaredLength = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return json({ error: `File too large (max ${Math.round(maxBytes / (1024 * 1024))} MB)` }, 413);
  }

  if (!req.body) {
    return json({ error: "Missing request body" }, 400);
  }

  if (!driver.consumeUpload(key, token)) {
    return json({ error: "This upload URL was already used" }, 409);
  }

  try {
    await driver.putObject(key, limitStream(req.body, maxBytes), contentType!);
  } catch (error) {
    driver.releaseUpload(key, token);
    if (error instanceof BodyTooLargeError) {
      return json({ error: error.message }, 413);
    }
    throw error;
  }

  return json({ success: true }, 200);
}
