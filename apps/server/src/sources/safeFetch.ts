import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { BodyTooLargeError, limitStream } from "@/storage/stream";

/**
 * SSRF-guarded fetch for user-influenced URLs.
 *
 * - http/https only, no credentials in the URL
 * - every hop's hostname is resolved and ALL addresses must be public
 *   (rejects loopback, RFC1918, link-local, CGNAT, multicast, unspecified,
 *   IPv4-mapped/NAT64/6to4 wrappers of those, ULA, documentation ranges)
 * - redirects are followed manually (max 5) and each hop is re-checked
 * - headers must arrive within `timeoutMs` (20 s); the body gets `bodyTimeoutMs`
 *
 * Known gap: Bun's fetch resolves DNS again, so a rebinding resolver could
 * answer differently between our check and the connect.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>;
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export const defaultLookup: LookupFn = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

export const SAFE_FETCH_DEFAULTS = {
  timeoutMs: 20_000,
  bodyTimeoutMs: 120_000,
  maxRedirects: 5,
  maxBytes: 60 * 1024 * 1024,
};

export interface SafeFetchOptions {
  fetchImpl?: FetchFn;
  lookup?: LookupFn;
  headers?: Record<string, string>;
  timeoutMs?: number;
  bodyTimeoutMs?: number;
  maxRedirects?: number;
}

// ── IP classification ────────────────────────────────────────────────────────

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

function isBlockedIPv4(bytes: number[]): boolean {
  const [a, b, c] = bytes;
  return (
    a === 0 || // 0.0.0.0/8 "this network" / unspecified
    a === 10 || // 10/8 private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 CGNAT
    (a === 169 && b === 254) || // link-local (cloud metadata)
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12 private
    (a === 192 && b === 168) || // 192.168/16 private
    (a === 192 && b === 0 && c === 0) || // 192.0.0/24 IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast 224/4, reserved 240/4, broadcast
  );
}

/** Parse an IPv6 literal into 8 16-bit words (handles `::` and embedded IPv4) */
function parseIPv6(input: string): number[] | null {
  let ip = input;
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);

  // Embedded dotted IPv4 tail (e.g. ::ffff:127.0.0.1)
  let tail: number[] = [];
  const lastColon = ip.lastIndexOf(":");
  if (lastColon === -1) return null;
  if (ip.slice(lastColon + 1).includes(".")) {
    const v4 = parseIPv4(ip.slice(lastColon + 1));
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    const prefix = ip.slice(0, lastColon + 1);
    ip = prefix.endsWith("::") ? prefix : prefix.slice(0, -1);
  }

  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parseWords = (s: string) => (s === "" ? [] : s.split(":"));
  const head = parseWords(halves[0]);
  const rest = halves.length === 2 ? parseWords(halves[1]) : [];
  const explicit = head.length + rest.length + tail.length;
  if (halves.length === 1 && explicit !== 8) return null;
  if (halves.length === 2 && explicit > 7) return null;

  const toWord = (w: string) => (/^[0-9a-fA-F]{1,4}$/.test(w) ? parseInt(w, 16) : NaN);
  const words = [...head.map(toWord), ...new Array<number>(8 - explicit).fill(0), ...rest.map(toWord), ...tail];
  return words.length === 8 && words.every((w) => !Number.isNaN(w)) ? words : null;
}

function isBlockedIPv6(w: number[]): boolean {
  const embeddedV4 = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  const allZero = (from: number, to: number) => w.slice(from, to).every((x) => x === 0);

  // ::/128 unspecified, ::1 loopback, ::/96 IPv4-compatible (deprecated)
  if (allZero(0, 6)) return true;
  // ::ffff:0:0/96 IPv4-mapped
  if (allZero(0, 5) && w[5] === 0xffff) return isBlockedIPv4(embeddedV4(w[6], w[7]));
  // ::ffff:0:0:0/96 IPv4-translated
  if (allZero(0, 4) && w[4] === 0xffff && w[5] === 0) return isBlockedIPv4(embeddedV4(w[6], w[7]));
  // 64:ff9b::/96 NAT64 (and 64:ff9b:1::/48 local-use NAT64)
  if (w[0] === 0x64 && w[1] === 0xff9b) {
    if (w[2] === 1) return true;
    return isBlockedIPv4(embeddedV4(w[6], w[7]));
  }
  // 2002::/16 6to4 wraps an IPv4 in words 1-2
  if (w[0] === 0x2002) return isBlockedIPv4(embeddedV4(w[1], w[2]));
  // 2001:0::/32 Teredo (obfuscated client address) — just refuse
  if (w[0] === 0x2001 && w[1] === 0) return true;
  // 2001:db8::/32 documentation
  if (w[0] === 0x2001 && w[1] === 0xdb8) return true;
  // 100::/64 discard
  if (w[0] === 0x100 && allZero(1, 4)) return true;
  const first = w[0];
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** True when an IP literal must not be contacted. Unparseable input counts as blocked. */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip.split("%")[0]);
  if (version === 4) {
    const bytes = parseIPv4(ip);
    return !bytes || isBlockedIPv4(bytes);
  }
  if (version === 6) {
    const words = parseIPv6(ip);
    return !words || isBlockedIPv6(words);
  }
  return true;
}

// ── URL checks ───────────────────────────────────────────────────────────────

/** Throws UnsafeUrlError unless the URL is http(s) and every address it resolves to is public */
export async function assertPublicUrl(rawUrl: string | URL, lookup: LookupFn = defaultLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Only http(s) URLs are allowed (got ${url.protocol})`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with credentials are not allowed");
  }

  // WHATWG URL already normalizes odd IPv4 forms (0x7f.1, 2130706433) to dotted quads
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  if (!host) throw new UnsafeUrlError("URL has no host");

  if (isIP(host)) {
    if (isBlockedIp(host)) throw new UnsafeUrlError(`Refusing to fetch private or reserved address ${host}`);
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host);
  } catch (error) {
    throw new UnsafeUrlError(`Could not resolve ${host}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (addresses.length === 0) throw new UnsafeUrlError(`Could not resolve ${host}`);
  const blocked = addresses.find((a) => isBlockedIp(a.address));
  if (blocked) {
    throw new UnsafeUrlError(`Refusing to fetch ${host}: resolves to private or reserved address ${blocked.address}`);
  }
  return url;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SafeFetchResult {
  response: Response;
  /** The URL after redirects */
  url: string;
}

/** GET a URL with SSRF checks on every hop. The returned body is bound to `bodyTimeoutMs`. */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const lookup = options.lookup ?? defaultLookup;
  const timeoutMs = options.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs;
  const bodyTimeoutMs = options.bodyTimeoutMs ?? SAFE_FETCH_DEFAULTS.bodyTimeoutMs;
  const maxRedirects = options.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects;

  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);

  try {
    let current = await assertPublicUrl(rawUrl, lookup);
    for (let hop = 0; ; hop++) {
      const response = await fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        headers: options.headers,
        signal: controller.signal,
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        void response.body?.cancel().catch(() => undefined);
        if (!location) throw new Error(`Redirect ${response.status} without a Location header`);
        if (hop >= maxRedirects) throw new UnsafeUrlError(`Too many redirects (max ${maxRedirects})`);
        current = await assertPublicUrl(new URL(location, current), lookup);
        continue;
      }

      // Headers arrived: swap the header timeout for a (longer) body timeout
      clearTimeout(timer);
      timer = setTimeout(
        () => controller.abort(new Error(`Download timed out after ${bodyTimeoutMs} ms`)),
        bodyTimeoutMs
      );
      const bodyTimer = timer;
      if (!response.body) {
        clearTimeout(bodyTimer);
        return { response, url: current.toString() };
      }
      const body = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          flush() {
            clearTimeout(bodyTimer);
          },
        })
      );
      return {
        response: new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }),
        url: current.toString(),
      };
    }
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

/**
 * Validate a downloaded response's size and return a byte stream capped at `maxBytes`.
 * Rejects early when Content-Length already exceeds the cap.
 */
export function limitedBody(response: Response, maxBytes = SAFE_FETCH_DEFAULTS.maxBytes): ReadableStream<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new BodyTooLargeError(maxBytes);
  }
  if (!response.body) throw new Error("Response has no body");
  return limitStream(response.body, maxBytes);
}
