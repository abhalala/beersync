import { getDeckBuffer, loadDeckBuffer, setPinnedBuffers } from "@/lib/dj/buffers";
import { serverNow } from "@/lib/dj/clock";
import { djEngine } from "@/lib/dj/engine";
import { analyzeInWorker, type TrackAnalysisResult } from "@/lib/dj/analysis";
import { isClockTrusted, useGlobalStore } from "@/store/global";
import { sendWSRequest } from "@/utils/ws";
import type {
  BeatGrid,
  DeckCommand,
  DeckId,
  DeckState,
  DjState,
  LibraryTrack,
  MixerPatch,
  MixerState,
  TrackMeta,
} from "@beatsync/shared";
import { ClientActionEnum, createDefaultMixer, createEmptyDeck, DECK_IDS, deckPositionAt } from "@beatsync/shared";
import { create } from "zustand";

export interface TrackRuntime {
  status: "loading" | "ready" | "error";
  /** Download progress 0..1 */
  progress: number;
  error?: string;
  analysis?: TrackAnalysisResult;
}

interface DjValues {
  decks: Record<DeckId, DeckState>;
  /** Snapshot still in effect until the newer one's scheduled anchor time */
  prevDecks: Partial<Record<DeckId, DeckState>>;
  mixer: MixerState;
  tracks: Record<string, TrackRuntime>;
  hasState: boolean;
}

interface DjActions {
  /** Full snapshot sent on (re)join; bootId identifies the server process */
  applyDjState: (state: DjState & { bootId?: string }) => void;
  applyDeckState: (deck: DeckState) => void;
  applyMixerState: (mixer: MixerState) => void;
  ensureTrack: (url: string) => void;
  reconcileAudio: () => void;
  sendDeckCommand: (deckId: DeckId, command: DeckCommand) => void;
  sendMixerPatch: (patch: MixerPatch) => void;
  claimDeck: (deckId: DeckId, claim: boolean) => void;
  importTrack: (track: LibraryTrack, loadToDeck?: DeckId) => void;
  reset: () => void;
}

const initialValues = (): DjValues => ({
  decks: { A: createEmptyDeck("A"), B: createEmptyDeck("B") },
  prevDecks: {},
  mixer: createDefaultMixer(),
  tracks: {},
  hasState: false,
});

const MIXER_SEND_INTERVAL_MS = 50;

/** Room collection metadata for a track (title, beat grid shared by the room, ...) */
export const getTrackMeta = (url: string | null): TrackMeta | undefined => {
  if (!url) return undefined;
  return useGlobalStore.getState().audioSources.find((s) => s.source.url === url)?.source.meta;
};

/**
 * Beat grid for a track: the room's shared grid (what SYNC and quantize use on
 * the server) when known, else this device's own analysis.
 */
export const getBeatGrid = (url: string | null, tracks: Record<string, TrackRuntime>): BeatGrid | null => {
  if (!url) return null;
  const meta = getTrackMeta(url);
  if (meta?.bpm !== undefined && meta.firstBeatSec !== undefined)
    return { bpm: meta.bpm, firstBeatSec: meta.firstBeatSec };
  const analysis = tracks[url]?.analysis;
  return analysis ? { bpm: analysis.bpm, firstBeatSec: analysis.firstBeatSec } : null;
};

const socketOrNull = () => {
  const socket = useGlobalStore.getState().socket;
  return socket && socket.readyState === WebSocket.OPEN ? socket : null;
};

const isAudioStarted = () => {
  const { hasUserStartedSystem, isInitingSystem } = useGlobalStore.getState();
  return hasUserStartedSystem && !isInitingSystem;
};

/**
 * Deck audio is placed on the room timeline through the clock offset, so it
 * must wait for a trustworthy offset. Right after a reconnect the offset is
 * either kept from the same server process (trusted) or reset because the
 * server restarted (untrusted until re-synced). Snapshots that arrive while
 * untrusted are only stored; every deck is reconciled once trust returns.
 */
const canPlaceDeckAudio = () => isAudioStarted() && isClockTrusted(useGlobalStore.getState());

export const useDjStore = create<DjValues & DjActions>((set, get) => {
  let pendingMixerPatch: MixerPatch | null = null;
  let mixerTimer: ReturnType<typeof setTimeout> | null = null;

  const flushMixerPatch = () => {
    mixerTimer = null;
    const socket = socketOrNull();
    if (!pendingMixerPatch || !socket) return;
    sendWSRequest({ ws: socket, request: { type: ClientActionEnum.enum.DJ_MIXER_UPDATE, patch: pendingMixerPatch } });
    pendingMixerPatch = null;
  };

  const mergePatch = (a: MixerPatch | null, b: MixerPatch): MixerPatch => ({
    ...a,
    ...b,
    channels: {
      A: { ...a?.channels?.A, ...b.channels?.A },
      B: { ...a?.channels?.B, ...b.channels?.B },
    },
  });

  const reconcileDeck = (deckId: DeckId) => {
    if (!canPlaceDeckAudio()) return;
    const deck = get().decks[deckId];
    djEngine.applyDeck(deck, deck.trackUrl ? getDeckBuffer(deck.trackUrl) : undefined);
  };

  const pinDeckTracks = () => {
    setPinnedBuffers(DECK_IDS.map((id) => get().decks[id].trackUrl).filter((u): u is string => !!u));
  };

  const reportAnalysis = (url: string, analysis: TrackAnalysisResult) => {
    const meta = getTrackMeta(url);
    if (meta?.firstBeatSec !== undefined && meta.key !== undefined && meta.durationSec !== undefined) return;
    const socket = socketOrNull();
    if (!socket) return;
    sendWSRequest({
      ws: socket,
      request: {
        type: ClientActionEnum.enum.DJ_TRACK_ANALYSIS,
        url,
        analysis: {
          bpm: analysis.bpm,
          firstBeatSec: analysis.firstBeatSec,
          key: analysis.key,
          durationSec: analysis.durationSec,
        },
      },
    });
  };

  const setTrack = (url: string, patch: Partial<TrackRuntime>) =>
    set((state) => ({
      tracks: { ...state.tracks, [url]: { ...(state.tracks[url] ?? { status: "loading", progress: 0 }), ...patch } },
    }));

  return {
    ...initialValues(),

    applyDjState: ({ decks, mixer, bootId }) => {
      // Full snapshot on (re)join is authoritative, even if versions went backwards
      // (e.g. the server restored an older backup)
      const next = { ...get().decks };
      for (const deck of decks) next[deck.deckId] = deck;
      set({ decks: next, prevDecks: {}, mixer, hasState: true });
      pinDeckTracks();
      for (const deck of decks) {
        if (deck.trackUrl) get().ensureTrack(deck.trackUrl);
      }
      // Before any deck is placed: a restarted server invalidates the clock, the
      // same server makes the kept clock trusted again (which reconciles every
      // deck through the subscription below, so don't do it twice)
      const wasTrusted = isClockTrusted(useGlobalStore.getState());
      useGlobalStore.getState().setServerBootId(bootId);
      const trustedNow = isClockTrusted(useGlobalStore.getState());
      if (wasTrusted || !trustedNow) get().reconcileAudio();
    },

    applyDeckState: (deck) => {
      const current = get().decks[deck.deckId];
      if (deck.version <= current.version && get().hasState) return;
      const prev = get().prevDecks[deck.deckId];
      // Keep showing whichever snapshot is actually sounding until the new anchor time
      const inEffect = prev && serverNow() < current.anchorServerTime ? prev : current;
      set((state) => ({
        decks: { ...state.decks, [deck.deckId]: deck },
        prevDecks: { ...state.prevDecks, [deck.deckId]: inEffect },
      }));
      pinDeckTracks();
      if (deck.trackUrl) get().ensureTrack(deck.trackUrl);
      reconcileDeck(deck.deckId);
    },

    applyMixerState: (mixer) => {
      if (mixer.version < get().mixer.version && get().hasState) return;
      set({ mixer });
      if (isAudioStarted()) djEngine.applyMixer(mixer);
    },

    ensureTrack: (url) => {
      if (get().tracks[url]) return;
      setTrack(url, { status: "loading", progress: 0 });
      let lastProgress = 0;
      loadDeckBuffer(url, (loaded, total) => {
        const progress = loaded / total;
        if (progress - lastProgress < 0.05 && progress < 1) return;
        lastProgress = progress;
        setTrack(url, { progress });
      })
        .then(async (buffer) => {
          setTrack(url, { status: "ready", progress: 1 });
          for (const id of DECK_IDS) if (get().decks[id].trackUrl === url) reconcileDeck(id);
          const analysis = await analyzeInWorker(buffer);
          setTrack(url, { analysis });
          reportAnalysis(url, analysis);
        })
        .catch((error: unknown) => {
          console.error(`[DJ] Failed to load ${url}`, error);
          setTrack(url, { status: "error", error: error instanceof Error ? error.message : String(error) });
        });
    },

    reconcileAudio: () => {
      if (!isAudioStarted()) return;
      // Mixer gains don't depend on the clock
      djEngine.applyMixer(get().mixer);
      for (const id of DECK_IDS) reconcileDeck(id);
    },

    sendDeckCommand: (deckId, command) => {
      const socket = socketOrNull();
      if (!socket) return;
      sendWSRequest({ ws: socket, request: { type: ClientActionEnum.enum.DJ_DECK_COMMAND, deckId, command } });
    },

    sendMixerPatch: (patch) => {
      pendingMixerPatch = mergePatch(pendingMixerPatch, patch);
      if (!mixerTimer) mixerTimer = setTimeout(flushMixerPatch, MIXER_SEND_INTERVAL_MS);
    },

    claimDeck: (deckId, claim) => {
      const socket = socketOrNull();
      if (!socket) return;
      sendWSRequest({ ws: socket, request: { type: ClientActionEnum.enum.DJ_CLAIM_DECK, deckId, claim } });
    },

    importTrack: (track, loadToDeck) => {
      const socket = socketOrNull();
      if (!socket) return;
      sendWSRequest({ ws: socket, request: { type: ClientActionEnum.enum.DJ_IMPORT_TRACK, track, loadToDeck } });
    },

    reset: () => {
      djEngine.stopAll();
      set(initialValues());
    },
  };
});

/** Playhead of a deck right now, as heard in the room */
export const getDeckDisplayPosition = (deckId: DeckId): number => {
  const { decks, prevDecks, tracks } = useDjStore.getState();
  const deck = decks[deckId];
  const prev = prevDecks[deckId];
  const now = serverNow();
  const inEffect = prev && now < deck.anchorServerTime ? prev : deck;
  const duration = deck.trackUrl
    ? (tracks[deck.trackUrl]?.analysis?.durationSec ?? getTrackMeta(deck.trackUrl)?.durationSec)
    : undefined;
  return deckPositionAt(inEffect, now, duration);
};

// Start the decks as soon as the listener starts audio (the "Start" gesture),
// and catch every deck up to its latest snapshot once the clock is trustworthy
// again after a reconnect
if (typeof window !== "undefined") {
  useGlobalStore.subscribe((state, prev) => {
    const started = state.hasUserStartedSystem && !state.isInitingSystem;
    const wasStarted = prev.hasUserStartedSystem && !prev.isInitingSystem;
    const trusted = isClockTrusted(state);
    const wasTrusted = isClockTrusted(prev);
    if ((started && !wasStarted) || (started && trusted && !wasTrusted)) useDjStore.getState().reconcileAudio();
  });
}
