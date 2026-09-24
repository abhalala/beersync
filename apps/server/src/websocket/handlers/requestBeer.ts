import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { broadcastClients } from "@/websocket/handlers/dj";
import { requireRoom } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";

export const handleRequestBeer: HandlerFunction<ExtractWSRequestFrom["REQUEST_BEER"]> = ({ ws, message, server }) => {
  const { room } = requireRoom(ws);
  room.setWantsBeer(ws.data.clientId, message.wants);
  broadcastClients(server, ws.data.roomId, room);
};
