import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { sendBroadcast } from "@/utils/responses";
import { requireRoom } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";

// Any listener may report analysis (it's derived from the audio everyone has);
// the room keeps the first beat grid so all devices sync against the same one.
export const handleDjTrackAnalysis: HandlerFunction<ExtractWSRequestFrom["DJ_TRACK_ANALYSIS"]> = ({
  ws,
  message,
  server,
}) => {
  const { room } = requireRoom(ws);
  if (!room.setTrackAnalysis(message.url, message.analysis)) return;
  sendBroadcast({
    server,
    roomId: ws.data.roomId,
    message: { type: "ROOM_EVENT", event: { type: "SET_AUDIO_SOURCES", sources: room.getAudioSources() } },
  });
};
