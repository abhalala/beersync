import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { broadcastDeck, resolveDj, sendDjNotice } from "@/websocket/handlers/dj";
import type { HandlerFunction } from "@/websocket/types";

export const handleDjClaimDeck: HandlerFunction<ExtractWSRequestFrom["DJ_CLAIM_DECK"]> = ({ ws, message, server }) => {
  const dj = resolveDj(ws);
  if (!dj) return;
  const result = dj.room.getDj().claimDeck({
    deckId: message.deckId,
    claim: message.claim,
    actor: dj.actor,
    isAdmin: dj.isAdmin,
  });
  if (!result.ok) {
    sendDjNotice(ws, "error", result.error);
    return;
  }
  broadcastDeck(server, ws.data.roomId, result.deck);
};
