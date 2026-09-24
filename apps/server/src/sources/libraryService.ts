import type { LibrarySearchResponse, LibrarySourcesResponse } from "@beatsync/shared";
import { z } from "zod";
import type { MusicSourceAdapter } from "@/sources/types";
import { SourceInputError } from "@/sources/types";

export const LIBRARY_MAX_LIMIT = 50;

const sourceParam = z
  .string({ error: "`source` is required" })
  .trim()
  .min(1, "`source` is required")
  .max(40, "`source` is too long");
const offsetParam = z.coerce
  .number({ error: "`offset` must be a number" })
  .int("`offset` must be an integer")
  .min(0, "`offset` must be >= 0")
  .max(10_000, "`offset` must be <= 10000")
  .default(0);
const limitParam = z.coerce
  .number({ error: "`limit` must be a number" })
  .int("`limit` must be an integer")
  .min(1, "`limit` must be >= 1")
  .max(LIBRARY_MAX_LIMIT, `\`limit\` must be <= ${LIBRARY_MAX_LIMIT}`)
  .default(20);

export const LibrarySearchParamsSchema = z.object({
  source: sourceParam,
  q: z
    .string({ error: "`q` is required" })
    .trim()
    .min(1, "`q` is required")
    .max(2048, "`q` must be at most 2048 characters"),
  offset: offsetParam,
  limit: limitParam,
});
export type LibrarySearchParams = z.infer<typeof LibrarySearchParamsSchema>;

export const LibraryBrowseParamsSchema = z.object({
  source: sourceParam,
  genre: z.string().trim().max(100, "`genre` must be at most 100 characters").optional(),
  offset: offsetParam,
  limit: limitParam,
});
export type LibraryBrowseParams = z.infer<typeof LibraryBrowseParamsSchema>;

export type LibraryResult<T> = { ok: true; data: T; cached?: boolean } | { ok: false; status: number; error: string };

/** URLSearchParams -> plain object, dropping empty values so defaults apply */
export function paramsToObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of params) if (v !== "") out[k] = v;
  return out;
}

function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join("; ");
}

/** Tiny TTL + LRU cache (Map preserves insertion order; re-insert on hit) */
export class TtlLruCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface LibraryServiceOptions {
  getSources: () => MusicSourceAdapter[];
  getSource: (id: string) => MusicSourceAdapter | undefined;
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export function createLibraryService(options: LibraryServiceOptions) {
  const cache = new TtlLruCache<LibrarySearchResponse>(options.maxEntries ?? 200, options.ttlMs ?? 60_000, options.now);
  // Coalesce identical concurrent requests into one upstream call
  const inflight = new Map<string, Promise<LibrarySearchResponse>>();

  function unknownSource(id: string): LibraryResult<never> {
    const available = options
      .getSources()
      .map((s) => s.info.id)
      .join(", ");
    return { ok: false, status: 404, error: `Unknown or disabled source '${id}'. Available sources: ${available}` };
  }

  async function cached(
    cacheKey: string,
    adapter: MusicSourceAdapter,
    action: string,
    run: () => Promise<LibrarySearchResponse>
  ): Promise<LibraryResult<LibrarySearchResponse>> {
    const hit = cache.get(cacheKey);
    if (hit) return { ok: true, data: hit, cached: true };

    let promise = inflight.get(cacheKey);
    if (!promise) {
      promise = run();
      inflight.set(cacheKey, promise);
    }
    try {
      const data = await promise;
      cache.set(cacheKey, data);
      return { ok: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof SourceInputError) return { ok: false, status: 400, error: message };
      console.error(`[library] ${adapter.info.id} ${action} failed:`, error);
      return { ok: false, status: 502, error: `${adapter.info.name} ${action} failed: ${message}` };
    } finally {
      inflight.delete(cacheKey);
    }
  }

  return {
    sources(): LibrarySourcesResponse {
      return { sources: options.getSources().map((s) => s.info) };
    },

    async search(rawParams: unknown): Promise<LibraryResult<LibrarySearchResponse>> {
      const parsed = LibrarySearchParamsSchema.safeParse(rawParams);
      if (!parsed.success) return { ok: false, status: 400, error: formatZodError(parsed.error) };
      const { source, q, offset, limit } = parsed.data;

      const adapter = options.getSource(source);
      if (!adapter) return unknownSource(source);
      if (!adapter.info.capabilities.search) {
        return { ok: false, status: 400, error: `Source '${source}' does not support search` };
      }

      const key = JSON.stringify(["search", source, q, offset, limit]);
      return cached(key, adapter, "search", () => adapter.search(q, { offset, limit }));
    },

    async browse(rawParams: unknown): Promise<LibraryResult<LibrarySearchResponse>> {
      const parsed = LibraryBrowseParamsSchema.safeParse(rawParams);
      if (!parsed.success) return { ok: false, status: 400, error: formatZodError(parsed.error) };
      const { source, genre, offset, limit } = parsed.data;

      const adapter = options.getSource(source);
      if (!adapter) return unknownSource(source);
      const browse = adapter.browse?.bind(adapter);
      if (!browse || !adapter.info.capabilities.browse) {
        return { ok: false, status: 400, error: `Source '${source}' does not support browsing` };
      }
      if (genre && adapter.info.genres.length > 0 && !adapter.info.genres.includes(genre)) {
        return {
          ok: false,
          status: 400,
          error: `Unknown genre '${genre}' for ${source}. Valid genres: ${adapter.info.genres.join(", ")}`,
        };
      }

      const key = JSON.stringify(["browse", source, genre ?? "", offset, limit]);
      return cached(key, adapter, "browse", () => browse({ genre, offset, limit }));
    },
  };
}

export type LibraryService = ReturnType<typeof createLibraryService>;
