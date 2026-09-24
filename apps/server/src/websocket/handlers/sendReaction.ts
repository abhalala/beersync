import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { sendBroadcast } from "@/utils/responses";
import { requireRoom } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";

export const handleSendReaction: HandlerFunction<ExtractWSRequestFrom["SEND_REACTION"]> = ({ ws, message, server }) => {
  const { room } = requireRoom(ws);
  if (!room.allowReaction(ws.data.clientId)) return;
  sendBroadcast({
    server,
    roomId: ws.data.roomId,
    message: {
      type: "ROOM_EVENT",
      event: { type: "REACTION", clientId: ws.data.clientId, username: ws.data.username, emoji: message.emoji },
    },
  });
};
