import { useGlobalStore } from "@/store/global";
import { sendWSRequest } from "@/utils/ws";
import type { ReactionEmoji, ReactionEventType } from "@beatsync/shared";
import { ClientActionEnum } from "@beatsync/shared";
import { create } from "zustand";

// A "sesh" is a Beersync session (a room). This store holds the social layer:
// live reactions and the beer (deck access) hand-offs.

export interface LiveReaction {
  id: number;
  clientId: string;
  username: string;
  emoji: ReactionEmoji;
  at: number;
}

const REACTION_TTL_MS = 2800;
const MAX_REACTIONS = 40;
let nextReactionId = 1;

interface SeshState {
  reactions: LiveReaction[];
  addReaction: (event: ReactionEventType) => void;
  sendReaction: (emoji: ReactionEmoji) => void;
  passBeer: (clientId: string, holding: boolean) => void;
  requestBeer: (wants: boolean) => void;
  setOpenBar: (open: boolean) => void;
}

const send = (request: Parameters<typeof sendWSRequest>[0]["request"]) => {
  const socket = useGlobalStore.getState().socket;
  if (socket && socket.readyState === WebSocket.OPEN) sendWSRequest({ ws: socket, request });
};

export const useSeshStore = create<SeshState>((set) => ({
  reactions: [],

  addReaction: ({ clientId, username, emoji }) => {
    const reaction: LiveReaction = { id: nextReactionId++, clientId, username, emoji, at: Date.now() };
    set((state) => ({ reactions: [...state.reactions, reaction].slice(-MAX_REACTIONS) }));
    setTimeout(() => {
      set((state) => ({ reactions: state.reactions.filter((r) => r.id !== reaction.id) }));
    }, REACTION_TTL_MS);
  },

  sendReaction: (emoji) => send({ type: ClientActionEnum.enum.SEND_REACTION, emoji }),
  passBeer: (clientId, holding) => send({ type: ClientActionEnum.enum.PASS_BEER, clientId, holding }),
  requestBeer: (wants) => send({ type: ClientActionEnum.enum.REQUEST_BEER, wants }),
  setOpenBar: (open) =>
    send({ type: ClientActionEnum.enum.SET_PLAYBACK_CONTROLS, permissions: open ? "EVERYONE" : "ADMIN_ONLY" }),
}));
