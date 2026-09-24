import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { broadcastClients, broadcastDeck, sendDjNotice } from "@/websocket/handlers/dj";
import { requireRoom } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";

export const handlePassBeer: HandlerFunction<ExtractWSRequestFrom["PASS_BEER"]> = ({ ws, message, server }) => {
  const { room } = requireRoom(ws);
  const error = room.passBeer({
    fromClientId: ws.data.clientId,
    targetClientId: message.clientId,
    holding: message.holding,
  });
  if (error) {
    sendDjNotice(ws, "error", error);
    return;
  }

  // Losing the beer also releases any deck the person had claimed
  if (!message.holding && !room.canDj(message.clientId)) {
    room
      .getDj()
      .releaseClaimsOf(message.clientId)
      .forEach((deck) => broadcastDeck(server, ws.data.roomId, deck));
  }

  const target = room.getClientSocket(message.clientId);
  if (target && message.clientId !== ws.data.clientId) {
    sendDjNotice(
      target,
      "info",
      message.holding
        ? `${ws.data.username} passed you a beer 🍺 You're on the decks.`
        : `${ws.data.username} took your beer. You're listening now.`
    );
  }
  broadcastClients(server, ws.data.roomId, room);
};
