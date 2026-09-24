import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { IS_DEMO_MODE } from "@/demo";
import { globalManager } from "@/managers";
import { getSource } from "@/sources";
import { downloadTrackToStorage } from "@/sources/ingest";
import { buildTrackMeta } from "@/sources/trackMeta";
import { getStorage } from "@/storage";
import { sendBroadcast } from "@/utils/responses";
import { resolveDj, sendDjNotice } from "@/websocket/handlers/dj";
import { executeDeckCommand } from "@/websocket/handlers/djDeckCommand";
import type { HandlerFunction } from "@/websocket/types";

/**
 * Import a library track into the room collection: resolve it via its source
 * adapter, download through the SSRF guard, store it (R2 or local), add it to
 * the room's audio sources and optionally load it onto a deck.
 */
export const handleDjImportTrack: HandlerFunction<ExtractWSRequestFrom["DJ_IMPORT_TRACK"]> = async ({
  ws,
  message,
  server,
}) => {
  if (IS_DEMO_MODE) return;

  // Importing is a DJ action: it needs a beer (resolveDj tells the client why not)
  const dj = resolveDj(ws);
  if (!dj) return;
  const { room } = dj;

  const roomId = ws.data.roomId;
  const { track, loadToDeck } = message;
  const loadDeck = (trackUrl: string) => {
    if (loadToDeck) executeDeckCommand({ ws, deckId: loadToDeck, command: { type: "LOAD", trackUrl }, server });
  };

  const adapter = getSource(track.sourceId);
  if (!adapter) {
    sendDjNotice(ws, "error", `Music source '${track.sourceId}' is not available on this server.`);
    return;
  }

  let meta: ReturnType<typeof buildTrackMeta>;
  try {
    meta = buildTrackMeta(track);
  } catch (error) {
    console.warn(`[${roomId}] DJ_IMPORT_TRACK invalid metadata:`, error);
    sendDjNotice(ws, "error", "That track has invalid metadata and can't be imported.");
    return;
  }

  // Already in the collection? Reuse it instead of downloading again.
  const existing = room
    .getAudioSources()
    .find((s) => s.meta?.sourceId === meta.sourceId && s.meta?.sourceTrackId === meta.sourceTrackId);
  if (existing) {
    loadDeck(existing.url);
    return;
  }

  const jobKey = `${meta.sourceId}:${meta.sourceTrackId}`;
  if (room.hasActiveStreamJob(jobKey)) {
    console.log(`[${roomId}] ${jobKey} is already importing, ignoring duplicate request`);
    return;
  }

  room.addStreamJob(jobKey);
  sendBroadcast({
    server,
    roomId,
    message: { type: "STREAM_JOB_UPDATE", activeJobCount: room.getActiveStreamJobCount() },
  });

  try {
    const resolved = await adapter.resolve(track.trackId);
    console.log(`[${roomId}] Importing ${jobKey} "${meta.title ?? track.title}"`);
    const { url } = await downloadTrackToStorage({ roomId, track, resolved, storage: getStorage() });

    if (globalManager.getRoom(roomId) !== room) {
      // Room was cleaned up mid-download; its media prefix is already gone or going
      console.warn(`[${roomId}] Room closed during import of ${jobKey}; dropping ${url}`);
      return;
    }

    const sources = room.addAudioSource({ url, meta });
    console.log(`[${roomId}] Imported ${jobKey} -> ${url} (${sources.length} sources)`);
    sendBroadcast({
      server,
      roomId,
      message: { type: "ROOM_EVENT", event: { type: "SET_AUDIO_SOURCES", sources } },
    });

    loadDeck(url);
  } catch (error) {
    console.error(`[${roomId}] DJ_IMPORT_TRACK ${jobKey} failed:`, error);
    const reason = error instanceof Error ? error.message : "unknown error";
    sendDjNotice(ws, "error", `Couldn't import "${meta.title ?? track.title}": ${reason}`);
  } finally {
    room.removeStreamJob(jobKey);
    sendBroadcast({
      server,
      roomId,
      message: { type: "STREAM_JOB_UPDATE", activeJobCount: room.getActiveStreamJobCount() },
    });
  }
};
