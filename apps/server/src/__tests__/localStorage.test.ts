// Local media storage (used when R2 isn't configured): key confinement,
// signed upload tokens, and HTTP Range serving (browsers seek/stream audio
// with Range requests; a wrong 206 body corrupts decoding silently).
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isValidMediaKey } from "@/storage/keys";
import { LocalStorageDriver } from "@/storage/local";
import { parseRange, receiveLocalUpload, serveLocalMedia } from "@/storage/localHttp";

/** Resolve to the rejection reason (bun's `.rejects` matchers aren't typed as thenables) */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
}

const roots: string[] = [];
function makeDriver(opts: { now?: () => number; secret?: string } = {}) {
  const rootDir = mkdtempSync(path.join(tmpdir(), "beersync-media-"));
  roots.push(rootDir);
  return new LocalStorageDriver({ rootDir, publicBaseUrl: "http://media.test", secret: "s3cret", ...opts });
}
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe("media key validation", () => {
  it.each([
    "room-123456/../../etc/passwd",
    "room-123456/..",
    "../room-123456/a.mp3",
    "/room-123456/a.mp3",
    "room-123456\\..\\a.mp3",
    "room-123456/sub/a.mp3",
    "room-../a.mp3",
    "rooms/a.mp3",
    "C:/room-1/a.mp3",
    "room-123456/",
    "room-123456/a\u0000.mp3",
  ])("rejects %p", (key) => {
    expect(isValidMediaKey(key)).toBe(false);
  });

  it("accepts generated upload names (delimiter star, colon, spaces)", () => {
    expect(isValidMediaKey("room-123456/My Song☆2026-09-24T12-00:00.000Z.mp3")).toBe(true);
  });

  it("refuses to serve an encoded traversal path", async () => {
    const driver = makeDriver();
    const res = await serveLocalMedia(new Request("http://x/"), driver, "room-1/..%2F..%2Fsecret");
    expect(res.status).toBe(400);
  });
});

describe("upload tokens", () => {
  const key = "room-123456/a☆x.mp3";

  it("rejects expired tokens", () => {
    let now = 1_000_000;
    const driver = makeDriver({ now: () => now });
    const token = driver.signUploadToken(key);
    expect(driver.verifyUploadToken(key, token)).toBe(true);
    now += 60 * 60 * 1000 + 1;
    expect(driver.verifyUploadToken(key, token)).toBe(false);
  });

  it("rejects forged tokens: other key, extended expiry, other secret", () => {
    const driver = makeDriver();
    const token = driver.signUploadToken(key);
    const [expires, sig] = token.split(".");

    expect(driver.verifyUploadToken("room-123456/other.mp3", token)).toBe(false);
    expect(driver.verifyUploadToken(key, `${Number(expires) + 86_400_000}.${sig}`)).toBe(false);
    expect(driver.verifyUploadToken(key, makeDriver({ secret: "other" }).signUploadToken(key))).toBe(false);
    expect(driver.verifyUploadToken(key, "")).toBe(false);
  });

  it("PUT round-trip: stores the body once, rejects replay and non-audio types", async () => {
    const driver = makeDriver();
    const { uploadUrl, publicUrl } = await driver.createUploadTarget(key, "audio/mpeg");
    const url = new URL(uploadUrl);
    const keyPath = url.pathname.slice("/media-upload/".length);
    const token = url.searchParams.get("token");

    const put = (type: string, body = "ID3-bytes") =>
      receiveLocalUpload(
        new Request(uploadUrl, { method: "PUT", body, headers: { "content-type": type } }),
        driver,
        keyPath,
        token
      );

    expect((await put("text/html")).status).toBe(415);
    expect((await put("audio/mpeg")).status).toBe(200);
    expect((await put("audio/mpeg", "overwrite")).status).toBe(409);

    const served = await serveLocalMedia(new Request(publicUrl), driver, new URL(publicUrl).pathname.slice(7));
    expect(await served.text()).toBe("ID3-bytes");
    expect(served.headers.get("content-type")).toBe("audio/mpeg");
  });

  it("aborts uploads that exceed the size cap even without Content-Length", async () => {
    const driver = makeDriver();
    const { uploadUrl } = await driver.createUploadTarget(key, "audio/mpeg");
    const url = new URL(uploadUrl);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(600));
        c.enqueue(new Uint8Array(600));
        c.close();
      },
    });
    const req = new Request(uploadUrl, { method: "PUT", body: stream, headers: { "content-type": "audio/mpeg" } });
    const res = await receiveLocalUpload(req, driver, url.pathname.slice(14), url.searchParams.get("token"), 1000);
    expect(res.status).toBe(413);
    const after = await serveLocalMedia(new Request("http://x/"), driver, url.pathname.slice(14));
    expect(after.status).toBe(404);
  });
});

describe("Range requests on /media", () => {
  const key = "room-42/range.mp3";
  const bytes = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));

  async function get(driver: LocalStorageDriver, range?: string) {
    const headers: Record<string, string> = range ? { range } : {};
    return serveLocalMedia(new Request("http://x/", { headers }), driver, key);
  }

  it("returns 206 with the exact slice and headers", async () => {
    const driver = makeDriver();
    await driver.putObject(key, bytes, "audio/mpeg");

    const res = await get(driver, "bytes=10-19");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 10-19/100");
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

    const open = await get(driver, "bytes=95-");
    expect(open.headers.get("content-range")).toBe("bytes 95-99/100");
    expect([...new Uint8Array(await open.arrayBuffer())]).toEqual([95, 96, 97, 98, 99]);

    const suffix = await get(driver, "bytes=-3");
    expect([...new Uint8Array(await suffix.arrayBuffer())]).toEqual([97, 98, 99]);

    const clamped = await get(driver, "bytes=98-5000");
    expect(clamped.headers.get("content-range")).toBe("bytes 98-99/100");
  });

  it("returns 416 past EOF and a full 200 without Range", async () => {
    const driver = makeDriver();
    await driver.putObject(key, bytes, "audio/mpeg");

    const past = await get(driver, "bytes=100-");
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */100");

    const full = await get(driver);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-length")).toBe("100");
  });

  it("ignores malformed or multi-range headers (serves full body)", () => {
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseRange("items=0-1", 100)).toBeNull();
    expect(parseRange("bytes=9-3", 100)).toBeNull();
  });
});

describe("deletePrefix", () => {
  it("removes only the given room's folder", async () => {
    const driver = makeDriver();
    await driver.putObject("room-1/a.mp3", new Uint8Array([1]), "audio/mpeg");
    await driver.putObject("room-1/b.mp3", new Uint8Array([1]), "audio/mpeg");
    await driver.putObject("room-12/c.mp3", new Uint8Array([1]), "audio/mpeg");

    expect(await driver.deletePrefix("room-1")).toBe(2);
    expect((await serveLocalMedia(new Request("http://x/"), driver, "room-12/c.mp3")).status).toBe(200);
    expect(await rejectionOf(driver.deletePrefix("room-1/../.."))).toBeInstanceOf(Error);
  });
});
