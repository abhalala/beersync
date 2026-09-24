import { validateR2Config } from "@/lib/r2";
import { LocalStorageDriver } from "@/storage/local";
import { R2StorageDriver } from "@/storage/r2";
import type { StorageDriver } from "@/storage/types";

export type { StorageBody, StorageDriver } from "@/storage/types";
export { LocalStorageDriver } from "@/storage/local";

let storage: StorageDriver | null = null;

/**
 * The process-wide media storage: R2 when fully configured (S3_* env vars),
 * otherwise a local folder served by this server.
 */
export function getStorage(): StorageDriver {
  if (storage) return storage;

  const r2 = validateR2Config();
  if (r2.isValid) {
    storage = new R2StorageDriver();
    console.log("[storage] Using R2 object storage");
  } else {
    const local = new LocalStorageDriver();
    storage = local;
    console.log(
      `[storage] R2 not configured (${r2.errors.length} missing S3_* vars) — using local media storage at ${local.rootDir}, served from ${local.publicBaseUrl}/media/`
    );
  }
  return storage;
}

/** The local driver when active, else null (R2 mode has no /media routes) */
export function getLocalStorage(): LocalStorageDriver | null {
  const driver = getStorage();
  return driver instanceof LocalStorageDriver ? driver : null;
}

/** Test hook: force a driver (pass null to re-detect on next getStorage()) */
export function setStorageForTests(driver: StorageDriver | null): void {
  storage = driver;
}

/** Delete all media for a room (call from room cleanup instead of deleteObjectsWithPrefix) */
export async function deleteRoomMedia(roomId: string): Promise<number> {
  return getStorage().deletePrefix(`room-${roomId}`);
}
