import type { DeckCommand, DeckId, ExtractWSRequestFrom } from "@beatsync/shared";
import type { ServerWebSocket } from "bun";
import type { BunServer, WSData } from "@/utils/websocket";
import { broadcastDeck, broadcastMixer, resolveDj, sendDjNotice } from "@/websocket/handlers/dj";
import type { HandlerFunction } from "@/websocket/types";

/** Apply a deck command on behalf of `ws` and broadcast the result (also used by track import) */
export const executeDeckCommand = ({
  ws,
  deckId,
  command,
  server,
}: {
  ws: ServerWebSocket<WSData>;
  deckId: DeckId;
  command: DeckCommand;
  server: BunServer;
}): void => {
  const dj = resolveDj(ws);
  if (!dj) return;
  const { room, actor, isAdmin } = dj;

  const result = room.getDj().applyCommand({
    deckId,
    command,
    actor,
    isAdmin,
    scheduleAtMs: room.getScheduledExecutionTime(),
    getTrackMeta: (url) => room.getTrackMeta(url),
  });

  if (!result.ok) {
    sendDjNotice(ws, "error", result.error);
    return;
  }

  broadcastDeck(server, ws.data.roomId, result.deck);
  if (result.mixer) broadcastMixer(server, ws.data.roomId, result.mixer);
};

export const handleDjDeckCommand: HandlerFunction<ExtractWSRequestFrom["DJ_DECK_COMMAND"]> = ({
  ws,
  message,
  server,
}) => {
  executeDeckCommand({ ws, deckId: message.deckId, command: message.command, server });
};
