import { audioContextManager } from "@/lib/audioContextManager";
import { getApiUrl } from "@/lib/urls";

// Decoded track cache for the decks. Separate from the party-mode queue's LRU:
// a track loaded on a deck must never be evicted mid-mix, so decks pin theirs.

const MAX_UNPINNED = 4;

interface Entry {
  promise: Promise<AudioBuffer>;
  buffer?: AudioBuffer;
  lastUsed: number;
}

const cache = new Map<string, Entry>();
const pinned = new Set<string>();

const resolveUrl = (url: string) => (url.startsWith("/") ? `${getApiUrl()}${url}` : url);

const download = async (url: string, onProgress?: (loaded: number, total: number) => void): Promise<ArrayBuffer> => {
  const response = await fetch(resolveUrl(url));
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const total = Number(response.headers.get("content-length") ?? 0);
  if (!response.body || !onProgress || total <= 0) return await response.arrayBuffer();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
};

const evict = () => {
  const unpinned = [...cache.entries()].filter(([url, e]) => !pinned.has(url) && e.buffer);
  if (unpinned.length <= MAX_UNPINNED) return;
  unpinned.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [url] of unpinned.slice(0, unpinned.length - MAX_UNPINNED)) cache.delete(url);
};

export const loadDeckBuffer = (url: string, onProgress?: (loaded: number, total: number) => void) => {
  const existing = cache.get(url);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.promise;
  }
  const entry: Entry = {
    lastUsed: Date.now(),
    promise: download(url, onProgress).then((bytes) => audioContextManager.decodeAudioData(bytes)),
  };
  entry.promise.then(
    (buffer) => {
      entry.buffer = buffer;
      evict();
    },
    () => cache.delete(url)
  );
  cache.set(url, entry);
  return entry.promise;
};

export const getDeckBuffer = (url: string): AudioBuffer | undefined => cache.get(url)?.buffer;

/** Pin exactly the given URLs (the tracks currently on decks) */
export const setPinnedBuffers = (urls: string[]) => {
  pinned.clear();
  urls.forEach((url) => pinned.add(url));
  evict();
};
