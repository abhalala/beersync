import { deleteObjectsWithPrefix, generatePresignedUploadUrl, getPublicAudioUrl, uploadBytes } from "@/lib/r2";
import { normalizeRoomPrefix, splitMediaKey } from "@/storage/keys";
import { readAll, toUint8Array } from "@/storage/stream";
import type { StorageBody, StorageDriver } from "@/storage/types";

/** Thin adapter over the existing lib/r2 helpers */
export class R2StorageDriver implements StorageDriver {
  readonly kind = "r2" as const;

  async putObject(key: string, body: StorageBody, contentType: string): Promise<{ publicUrl: string }> {
    const { roomId, fileName } = splitMediaKey(key);
    // PutObject needs a known length; imports are size-capped upstream so buffering is fine
    const bytes = body instanceof ReadableStream ? await readAll(body) : toUint8Array(body);
    const publicUrl = await uploadBytes(bytes, roomId, fileName, contentType);
    return { publicUrl };
  }

  publicUrl(key: string): string {
    const { roomId, fileName } = splitMediaKey(key);
    return getPublicAudioUrl(roomId, fileName);
  }

  async deletePrefix(prefix: string): Promise<number> {
    const { deletedCount } = await deleteObjectsWithPrefix(normalizeRoomPrefix(prefix));
    return deletedCount;
  }

  async createUploadTarget(key: string, contentType: string): Promise<{ uploadUrl: string; publicUrl: string }> {
    const { roomId, fileName } = splitMediaKey(key);
    const uploadUrl = await generatePresignedUploadUrl(roomId, fileName, contentType);
    return { uploadUrl, publicUrl: getPublicAudioUrl(roomId, fileName) };
  }
}
