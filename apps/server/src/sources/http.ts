import type { FetchFn } from "@/sources/safeFetch";
import { UpstreamError } from "@/sources/types";

export const UPSTREAM_TIMEOUT_MS = 10_000;

export const defaultFetch: FetchFn = (input, init) => fetch(input, init);

/**
 * GET JSON from a configured (trusted) upstream API with a timeout.
 * Any network/HTTP/parse failure becomes an UpstreamError.
 */
export async function fetchJson(
  url: string,
  fetchImpl: FetchFn = defaultFetch,
  timeoutMs = UPSTREAM_TIMEOUT_MS
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new UpstreamError(`Request failed: ${error instanceof Error ? error.message : String(error)}`, undefined, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new UpstreamError(`HTTP ${response.status}`, response.status);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new UpstreamError("Invalid JSON from upstream", response.status, { cause: error });
  }
}

/** Drop undefined/null/empty-string fields so responses stay compact */
export function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "")) as T;
}
