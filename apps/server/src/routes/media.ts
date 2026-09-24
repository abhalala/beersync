import { getLocalStorage } from "@/storage";
import { receiveLocalUpload, serveLocalMedia } from "@/storage/localHttp";
import { jsonResponse } from "@/utils/responses";

export const MEDIA_PREFIX = "/media/";
export const MEDIA_UPLOAD_PREFIX = "/media-upload/";

/** GET/HEAD /media/<key> — local storage mode only */
export async function handleMedia(req: Request, url: URL): Promise<Response> {
  const driver = getLocalStorage();
  if (!driver) return jsonResponse({ error: "Not found" }, 404);
  return serveLocalMedia(req, driver, url.pathname.slice(MEDIA_PREFIX.length));
}

/** PUT /media-upload/<key>?token= — local storage mode only */
export async function handleMediaUpload(req: Request, url: URL): Promise<Response> {
  const driver = getLocalStorage();
  if (!driver) return jsonResponse({ error: "Not found" }, 404);
  return receiveLocalUpload(req, driver, url.pathname.slice(MEDIA_UPLOAD_PREFIX.length), url.searchParams.get("token"));
}
