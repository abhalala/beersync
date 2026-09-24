// SSRF guard for server-side downloads of user-supplied URLs (DJ_IMPORT_TRACK).
// A regression here silently exposes internal services / cloud metadata.
import { describe, expect, it, mock } from "bun:test";
import type { FetchFn, LookupFn } from "@/sources/safeFetch";
import { UnsafeUrlError, assertPublicUrl, isBlockedIp, safeFetch } from "@/sources/safeFetch";

/** Resolve to the rejection reason (bun's `.rejects` matchers aren't typed as thenables) */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
}

const publicLookup: LookupFn = () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]);

function fetchReturning(...responses: Response[]) {
  const queue = [...responses];
  return mock<FetchFn>(() => Promise.resolve(queue.shift() ?? new Response("done")));
}

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "64:ff9b::a9fe:a9fe", // NAT64 of 169.254.169.254
    "2002:c0a8:0101::1", // 6to4 of 192.168.1.1
    "fe80::1%eth0",
    "fd12:3456::1",
    "ff02::1",
  ])("blocks %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "::ffff:8.8.8.8", "2606:4700:4700::1111"])("allows public %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe("assertPublicUrl", () => {
  it("rejects IP-literal hosts in private ranges, including obfuscated and IPv6-mapped forms", async () => {
    for (const url of [
      "http://127.0.0.1/a.mp3",
      "http://2130706433/a.mp3", // decimal 127.0.0.1
      "http://0x7f.1/a.mp3",
      "http://[::1]:8080/a.mp3",
      "http://[::ffff:127.0.0.1]/a.mp3",
      "http://169.254.169.254/latest/meta-data/",
    ]) {
      expect(await rejectionOf(assertPublicUrl(url, publicLookup))).toBeInstanceOf(UnsafeUrlError);
    }
  });

  it("rejects hostnames when ANY resolved address is private", async () => {
    const lookup: LookupFn = () =>
      Promise.resolve([
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ]);
    expect(await rejectionOf(assertPublicUrl("https://evil.example/a.mp3", lookup))).toHaveProperty(
      "message",
      expect.stringMatching(/10\.0\.0\.5/)
    );
  });

  it("rejects non-http schemes and embedded credentials", async () => {
    expect(await rejectionOf(assertPublicUrl("file:///etc/passwd", publicLookup))).toBeInstanceOf(UnsafeUrlError);
    expect(await rejectionOf(assertPublicUrl("ftp://example.com/a.mp3", publicLookup))).toBeInstanceOf(UnsafeUrlError);
    expect(await rejectionOf(assertPublicUrl("http://user:pw@example.com/a.mp3", publicLookup))).toBeInstanceOf(
      UnsafeUrlError
    );
  });
});

describe("safeFetch", () => {
  it("never calls fetch for a host resolving to loopback", async () => {
    const fetchImpl = fetchReturning();
    const lookup: LookupFn = () => Promise.resolve([{ address: "::1", family: 6 }]);
    expect(await rejectionOf(safeFetch("http://localhost.evil/a.mp3", { fetchImpl, lookup }))).toBeInstanceOf(
      UnsafeUrlError
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("re-checks redirect targets and refuses a hop to a private address", async () => {
    const fetchImpl = fetchReturning(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } })
    );
    expect(
      await rejectionOf(safeFetch("https://public.example/a.mp3", { fetchImpl, lookup: publicLookup }))
    ).toBeInstanceOf(UnsafeUrlError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Redirects must be handled manually, otherwise the private hop is fetched by the runtime
    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("re-resolves redirect hostnames (DNS pointing at private space)", async () => {
    const fetchImpl = fetchReturning(
      new Response(null, { status: 301, headers: { location: "/next" } }),
      new Response(null, { status: 307, headers: { location: "http://internal.corp/x" } })
    );
    const lookup: LookupFn = (host) =>
      Promise.resolve([{ address: host === "internal.corp" ? "192.168.0.10" : "93.184.216.34", family: 4 }]);
    expect(await rejectionOf(safeFetch("https://public.example/a.mp3", { fetchImpl, lookup }))).toHaveProperty(
      "message",
      expect.stringMatching(/192\.168/)
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe("https://public.example/next");
  });

  it("follows public redirects and reports the final URL, capped at maxRedirects", async () => {
    const ok = fetchReturning(
      new Response(null, { status: 302, headers: { location: "https://cdn.example/b.mp3" } }),
      new Response("audio", { status: 200, headers: { "content-type": "audio/mpeg" } })
    );
    const result = await safeFetch("https://public.example/a.mp3", { fetchImpl: ok, lookup: publicLookup });
    expect(result.url).toBe("https://cdn.example/b.mp3");
    expect(await result.response.text()).toBe("audio");

    const loop = mock<FetchFn>(() =>
      Promise.resolve(new Response(null, { status: 302, headers: { location: "https://public.example/again" } }))
    );
    expect(
      await rejectionOf(
        safeFetch("https://public.example/a.mp3", { fetchImpl: loop, lookup: publicLookup, maxRedirects: 5 })
      )
    ).toHaveProperty("message", expect.stringMatching(/Too many redirects/));
    expect(loop).toHaveBeenCalledTimes(6);
  });
});
