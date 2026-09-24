import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { broadcastMixer, resolveDj } from "@/websocket/handlers/dj";
import type { HandlerFunction } from "@/websocket/types";

// Mixer moves apply as soon as they arrive (no scheduling): a few ms of skew
// between devices is inaudible for EQ/fader moves, and immediacy matters more.
export const handleDjMixerUpdate: HandlerFunction<ExtractWSRequestFrom["DJ_MIXER_UPDATE"]> = ({
  ws,
  message,
  server,
}) => {
  const dj = resolveDj(ws);
  if (!dj) return;
  const mixer = dj.room.getDj().applyMixerPatch(message.patch, dj.actor);
  broadcastMixer(server, ws.data.roomId, mixer);
};
