import type { DeckState, DjActor, MixerState } from "@beatsync/shared";
import type { ServerWebSocket } from "bun";
import type { RoomManager } from "@/managers";
import { sendBroadcast, sendUnicast } from "@/utils/responses";
import type { BunServer, WSData } from "@/utils/websocket";
import { requireRoom } from "@/websocket/middlewares";

/**
 * Resolve the room + acting DJ for a DJ message. DJs must hold a beer (or be
 * the sesh host, or the sesh is an open bar). Unlike other
 * handlers we tell the client why instead of failing silently: a DJ pressing
 * a dead button mid-set needs to know.
 */
export const resolveDj = (
  ws: ServerWebSocket<WSData>
): { room: RoomManager; actor: DjActor; isAdmin: boolean } | null => {
  const { room } = requireRoom(ws);
  const client = room.getClient(ws.data.clientId);
  if (!client) return null;
  if (!room.canDj(client.clientId)) {
    sendDjNotice(ws, "error", "You need a beer to touch the decks. Ask a beer holder to pass you one.");
    return null;
  }
  return { room, actor: { clientId: client.clientId, username: client.username }, isAdmin: client.isAdmin };
};

export const sendDjNotice = (ws: ServerWebSocket<WSData>, level: "info" | "error", message: string) => {
  sendUnicast({ ws, message: { type: "DJ_NOTICE", level, message } });
};

export const broadcastDeck = (server: BunServer, roomId: string, deck: DeckState) => {
  sendBroadcast({ server, roomId, message: { type: "ROOM_EVENT", event: { type: "DJ_DECK_STATE", deck } } });
};

export const broadcastMixer = (server: BunServer, roomId: string, mixer: MixerState) => {
  sendBroadcast({ server, roomId, message: { type: "ROOM_EVENT", event: { type: "DJ_MIXER_STATE", mixer } } });
};

/** Push the current people list to everyone right away (role changes shouldn't wait for the debounce) */
export const broadcastClients = (server: BunServer, roomId: string, room: RoomManager) => {
  sendBroadcast({
    server,
    roomId,
    message: { type: "ROOM_EVENT", event: { type: "CLIENT_CHANGE", clients: room.getClients() } },
  });
};
