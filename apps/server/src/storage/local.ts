import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertValidMediaKey, encodeKeyPath, normalizeRoomPrefix } from "@/storage/keys";
import type { StorageBody, StorageDriver } from "@/storage/types";

export const LOCAL_UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
export const LOCAL_UPLOAD_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_PUBLIC_SERVER_URL = "http://localhost:8080";

export interface LocalStorageOptions {
  /** Directory holding media; defaults to LOCAL_MEDIA_DIR or `.data/media` (relative to cwd = apps/server) */
  rootDir?: string;
  /** Absolute origin browsers use to reach this server; defaults to PUBLIC_SERVER_URL or http://localhost:8080 */
  publicBaseUrl?: string;
  /** HMAC secret for upload tokens; defaults to LOCAL_UPLOAD_SECRET or a random per-process secret */
  secret?: string;
  uploadTtlMs?: number;
  now?: () => number;
}

/**
 * Filesystem-backed storage for running without R2. Objects are served by the
 * `/media/<key>` route and browsers upload via `PUT /media-upload/<key>?token=`
 * (see ./localHttp.ts), mirroring the R2 presigned-URL flow.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly kind = "local" as const;
  readonly rootDir: string;
  readonly publicBaseUrl: string;
  readonly uploadTtlMs: number;
  private readonly secret: Buffer;
  private readonly now: () => number;
  /** key -> token expiry; a token is single-use so a leaked URL can't overwrite a finished upload */
  private readonly consumedUploads = new Map<string, number>();
  private gitignoreWritten = false;

  constructor(options: LocalStorageOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.env.LOCAL_MEDIA_DIR ?? ".data/media");
    this.publicBaseUrl = (options.publicBaseUrl ?? process.env.PUBLIC_SERVER_URL ?? DEFAULT_PUBLIC_SERVER_URL).replace(
      /\/+$/,
      ""
    );
    const secret = options.secret ?? process.env.LOCAL_UPLOAD_SECRET;
    this.secret = secret ? Buffer.from(secret, "utf8") : randomBytes(32);
    this.uploadTtlMs = options.uploadTtlMs ?? LOCAL_UPLOAD_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /** Absolute file path for a key; throws on invalid keys or anything resolving outside rootDir */
  resolvePath(key: string): string {
    assertValidMediaKey(key);
    const resolved = path.resolve(this.rootDir, ...key.split("/"));
    if (!resolved.startsWith(this.rootDir + path.sep)) {
      throw new Error(`Invalid media key: ${JSON.stringify(key)}`);
    }
    return resolved;
  }

  publicUrl(key: string): string {
    assertValidMediaKey(key);
    return `${this.publicBaseUrl}/media/${encodeKeyPath(key)}`;
  }

  async putObject(key: string, body: StorageBody, _contentType: string): Promise<{ publicUrl: string }> {
    const filePath = this.resolvePath(key);
    await this.ensureDir(path.dirname(filePath));

    // Write to a temp file and rename so readers never see a partial object
    const tmpPath = `${filePath}.part-${randomBytes(6).toString("hex")}`;
    try {
      if (body instanceof ReadableStream) {
        const sink = Bun.file(tmpPath).writer();
        try {
          const reader = body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            await sink.write(value);
          }
        } finally {
          await sink.end();
        }
      } else {
        await writeFile(tmpPath, body instanceof Uint8Array ? body : new Uint8Array(body));
      }
      await rename(tmpPath, filePath);
    } catch (error) {
      await unlink(tmpPath).catch(() => undefined);
      throw error;
    }

    return { publicUrl: this.publicUrl(key) };
  }

  async deletePrefix(prefix: string): Promise<number> {
    const roomDir = path.resolve(this.rootDir, normalizeRoomPrefix(prefix));
    let count = 0;
    try {
      const entries = await readdir(roomDir, { withFileTypes: true });
      count = entries.filter((e) => e.isFile()).length;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
    await rm(roomDir, { recursive: true, force: true });
    return count;
  }

  createUploadTarget(key: string, _contentType: string): Promise<{ uploadUrl: string; publicUrl: string }> {
    const token = this.signUploadToken(key);
    return Promise.resolve({
      uploadUrl: `${this.publicBaseUrl}/media-upload/${encodeKeyPath(key)}?token=${encodeURIComponent(token)}`,
      publicUrl: this.publicUrl(key),
    });
  }

  /** Token = `<expiresAtMs>.<base64url HMAC-SHA256(key \n expiresAtMs)>` */
  signUploadToken(key: string, expiresAt = this.now() + this.uploadTtlMs): string {
    assertValidMediaKey(key);
    return `${expiresAt}.${this.hmac(key, expiresAt)}`;
  }

  verifyUploadToken(key: string, token: string | null | undefined): boolean {
    if (!token) return false;
    const match = /^(\d{1,16})\.([A-Za-z0-9_-]{16,128})$/.exec(token);
    if (!match) return false;
    const expiresAt = Number(match[1]);
    if (!Number.isSafeInteger(expiresAt) || this.now() > expiresAt) return false;

    const expected = Buffer.from(this.hmac(key, expiresAt));
    const given = Buffer.from(match[2]);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** Mark a token's key as used; returns false if it was already used */
  consumeUpload(key: string, token: string): boolean {
    const now = this.now();
    for (const [k, exp] of this.consumedUploads) {
      if (exp < now) this.consumedUploads.delete(k);
    }
    const consumedKey = `${key}\n${token}`;
    if (this.consumedUploads.has(consumedKey)) return false;
    this.consumedUploads.set(consumedKey, Number(token.split(".")[0]));
    return true;
  }

  /** Allow a token to be retried after a failed upload */
  releaseUpload(key: string, token: string): void {
    this.consumedUploads.delete(`${key}\n${token}`);
  }

  private hmac(key: string, expiresAt: number): string {
    return createHmac("sha256", this.secret).update(`${key}\n${expiresAt}`).digest("base64url");
  }

  private async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    if (!this.gitignoreWritten) {
      this.gitignoreWritten = true;
      // Keep local media out of git without touching the repo's .gitignore
      await writeFile(path.join(this.rootDir, ".gitignore"), "*\n", { flag: "wx" }).catch(() => undefined);
    }
  }
}
