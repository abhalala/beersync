import { getSource, getSources } from "@/sources";
import { createLibraryService, paramsToObject } from "@/sources/libraryService";
import type { LibraryResult } from "@/sources/libraryService";
import { jsonResponse } from "@/utils/responses";

const libraryService = createLibraryService({ getSources, getSource });

function toResponse<T>(result: LibraryResult<T>): Response {
  if (!result.ok) return jsonResponse({ error: result.error }, result.status);
  return jsonResponse(result.data);
}

/** GET /library/sources -> LibrarySourcesResponse (enabled sources only) */
export function handleLibrarySources(req: Request): Response {
  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
  return jsonResponse(libraryService.sources());
}

/** GET /library/search?source=&q=&offset=&limit= -> LibrarySearchResponse */
export async function handleLibrarySearch(req: Request, url: URL): Promise<Response> {
  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
  return toResponse(await libraryService.search(paramsToObject(url.searchParams)));
}

/** GET /library/browse?source=&genre=&offset=&limit= -> LibrarySearchResponse */
export async function handleLibraryBrowse(req: Request, url: URL): Promise<Response> {
  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
  return toResponse(await libraryService.browse(paramsToObject(url.searchParams)));
}
