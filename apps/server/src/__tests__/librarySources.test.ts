// Library adapters + /library search cache. Upstream APIs are mocked: the
// sandbox has no network, and upstream shapes drift (missing artwork, tracks
// that can't be streamed) in ways that would otherwise surface as broken UI.
import { describe, expect, it, mock } from "bun:test";
import { AudiusAdapter, mapAudiusTrack } from "@/sources/audius";
import { createLibraryService } from "@/sources/libraryService";
import type { FetchFn } from "@/sources/safeFetch";
import { buildTrackMeta, normalizeSourceTrackId } from "@/sources/trackMeta";

const baseTrack = {
  id: "D7KyD",
  title: "Night Drive",
  user: { name: "DJ Test", handle: "djtest" },
  artwork: { "150x150": "https://img/150.jpg", "480x480": "https://img/480.jpg" },
  duration: 245,
  genre: "Techno",
  release_date: "2024-01-01",
  permalink: "/djtest/night-drive",
  is_streamable: true,
};

describe("Audius mapping", () => {
  it("maps a full track, preferring 480px artwork and absolute permalinks", () => {
    expect(mapAudiusTrack({ ...baseTrack, bpm: 128, musical_key: "A minor" })).toEqual({
      sourceId: "audius",
      trackId: "D7KyD",
      title: "Night Drive",
      artist: "DJ Test",
      artworkUrl: "https://img/480.jpg",
      durationSec: 245,
      bpm: 128,
      key: "8A",
      genre: "Techno",
      releaseDate: "2024-01-01",
      permalink: "https://audius.co/djtest/night-drive",
    });
  });

  it("tolerates missing/null artwork, null fields and falls back to the 150px size", () => {
    const noArt = mapAudiusTrack({ ...baseTrack, artwork: null, release_date: null, genre: null, bpm: null });
    expect(noArt).not.toBeNull();
    expect(noArt!.artworkUrl).toBeUndefined();
    expect("releaseDate" in noArt!).toBe(false);

    const withoutArtworkKey: Record<string, unknown> = { ...baseTrack };
    delete withoutArtworkKey.artwork;
    expect(mapAudiusTrack(withoutArtworkKey)?.artworkUrl).toBeUndefined();
    expect(mapAudiusTrack({ ...baseTrack, artwork: { "150x150": "https://img/150.jpg" } })?.artworkUrl).toBe(
      "https://img/150.jpg"
    );
  });

  it("skips non-streamable and malformed tracks from a list response", async () => {
    const fetchImpl = mock<FetchFn>(() =>
      Promise.resolve(
        Response.json({
          data: [baseTrack, { ...baseTrack, id: "x2", is_streamable: false }, { id: "x3" }, { ...baseTrack, id: 99 }],
        })
      )
    );
    const adapter = new AudiusAdapter({ fetchImpl, env: {} });
    const res = await adapter.search("night", { offset: 0, limit: 10 });
    expect(res.items.map((t) => t.trackId)).toEqual(["D7KyD", "99"]);
    expect(res.nextOffset).toBeNull();

    const called = new URL(fetchImpl.mock.calls[0][0]);
    expect(called.pathname).toBe("/v1/tracks/search");
    expect(called.searchParams.get("app_name")).toBe("beersync");
  });

  it("pages trending locally since the endpoint ignores offset/limit", async () => {
    const data = Array.from({ length: 5 }, (_, i) => ({ ...baseTrack, id: `t${i}` }));
    const adapter = new AudiusAdapter({
      fetchImpl: () => Promise.resolve(Response.json({ data })),
      env: {},
    });
    const page = await adapter.browse({ genre: "Techno", offset: 2, limit: 2 });
    expect(page.items.map((t) => t.trackId)).toEqual(["t2", "t3"]);
    expect(page.nextOffset).toBe(4);
    const last = await adapter.browse({ genre: "Techno", offset: 4, limit: 2 });
    expect(last.nextOffset).toBeNull();
  });
});

describe("library service cache", () => {
  function setup() {
    const fetchImpl = mock<FetchFn>(() => Promise.resolve(Response.json({ data: [baseTrack] })));
    const adapter = new AudiusAdapter({ fetchImpl, env: {} });
    let now = 0;
    const service = createLibraryService({
      getSources: () => [adapter],
      getSource: (id) => (id === "audius" ? adapter : undefined),
      now: () => now,
    });
    return { service, fetchImpl, advance: (ms: number) => (now += ms) };
  }

  it("serves a repeated search from cache without a second upstream call, until the TTL expires", async () => {
    const { service, fetchImpl, advance } = setup();
    const params = { source: "audius", q: "night", offset: "0", limit: "10" };

    const first = await service.search(params);
    const second = await service.search(params);
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await service.search({ ...params, offset: "10" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    advance(60_001);
    await service.search(params);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not cache upstream failures and reports them as 502", async () => {
    const { service, fetchImpl } = setup();
    fetchImpl.mockImplementationOnce(() => Promise.resolve(new Response("boom", { status: 500 })));
    const failed = await service.search({ source: "audius", q: "x" });
    expect(failed).toMatchObject({ ok: false, status: 502 });
    const retried = await service.search({ source: "audius", q: "x" });
    expect(retried.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("validates params before touching upstream", async () => {
    const { service, fetchImpl } = setup();
    expect(await service.search({ source: "audius", q: "x", limit: "51" })).toMatchObject({ ok: false, status: 400 });
    expect(await service.search({ source: "audius" })).toMatchObject({ ok: false, status: 400 });
    expect(await service.search({ source: "nope", q: "x" })).toMatchObject({ ok: false, status: 404 });
    expect(await service.browse({ source: "audius", genre: "Polka" })).toMatchObject({ ok: false, status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("import metadata", () => {
  it("hashes over-long source ids (URLs) so they fit TrackMeta and still de-dupe", () => {
    const longUrl = `https://example.com/${"a".repeat(300)}.mp3`;
    const id = normalizeSourceTrackId(longUrl);
    expect(id.length).toBeLessThanOrEqual(200);
    expect(normalizeSourceTrackId(longUrl)).toBe(id);
  });

  it("drops client-supplied values the shared TrackMeta schema would reject", () => {
    const meta = buildTrackMeta({
      sourceId: "audius",
      trackId: "1",
      title: "t".repeat(500),
      bpm: 999,
      key: "C major",
      artworkUrl: "javascript:alert(1)",
      durationSec: -1,
    });
    expect(meta.title).toHaveLength(300);
    expect(meta.bpm).toBeUndefined();
    expect(meta.key).toBe("8B");
    expect(meta.artworkUrl).toBeUndefined();
    expect(meta.durationSec).toBeUndefined();
  });
});
