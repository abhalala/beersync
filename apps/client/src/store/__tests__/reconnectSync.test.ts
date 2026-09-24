// Reconnect mid-set: the deck engine places audio on the room timeline through
// the clock offset, so a DJ_STATE snapshot re-sent on reconnect must never reach
// the engine with a zeroed or unverified offset (that restarts playing decks at
// the wrong position, audible to the whole room, and nothing errors). Across a
// reconnect to the same server process the previous offset stays valid; a
// restarted process (new bootId) invalidates it until a fresh sync.

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { djEngine, isDeckContinuation } from "@/lib/dj/engine";
import { useDjStore } from "@/store/dj";
import { MAX_NTP_MEASUREMENTS, useGlobalStore } from "@/store/global";
import type { NTPMeasurement } from "@/utils/ntp";
import { dispatchWSResponse } from "@/websocket/dispatch";
import type { WSResponseContext } from "@/websocket/types";
import { createDefaultMixer, createEmptyDeck, type DeckState } from "@beatsync/shared";

const initialGlobalState = useGlobalStore.getState();
const initialDjState = useDjStore.getState();

const TRACK = "https://cdn.example/track.mp3";
const OFFSET_MS = 500;

const context = (): WSResponseContext => ({
  ws: { send: () => {}, readyState: WebSocket.OPEN } as unknown as WebSocket,
  markNTPResponseReceived: () => {},
});

const playingDeck = (deckId: "A" | "B", version = 1): DeckState => ({
  ...createEmptyDeck(deckId),
  trackUrl: TRACK,
  status: "playing",
  anchorServerTime: 1_000_000,
  anchorPositionSec: 12,
  version,
});

const sendDjState = (bootId: string | undefined, decks = [playingDeck("A"), playingDeck("B")]) =>
  dispatchWSResponse({
    response: { type: "ROOM_EVENT", event: { type: "DJ_STATE", decks, mixer: createDefaultMixer(), bootId } },
    context: context(),
  });

const completeSync = (offset = OFFSET_MS) => {
  const measurement: NTPMeasurement = { t0: 0, t1: 0, t2: 0, t3: 0, roundTripDelay: 20, clockOffset: offset };
  for (let i = 0; i < MAX_NTP_MEASUREMENTS; i++) useGlobalStore.getState().addProbePairResult(measurement);
};

describe("reconnect mid-set", () => {
  let applyDeck: ReturnType<typeof spyOn>;
  /** offsetEstimate seen by the engine on each applyDeck call */
  let offsetsSeen: number[];

  beforeEach(() => {
    offsetsSeen = [];
    applyDeck = spyOn(djEngine, "applyDeck").mockImplementation(() => {
      offsetsSeen.push(useGlobalStore.getState().offsetEstimate);
    });
    spyOn(djEngine, "applyMixer").mockImplementation(() => {});
    useGlobalStore.setState(initialGlobalState, true);
    useDjStore.setState(initialDjState, true);
    // Audio already started by the listener's Start gesture
    useGlobalStore.setState({ hasUserStartedSystem: true, isInitingSystem: false });
    // Track already downloading, so ensureTrack doesn't hit the network
    useDjStore.setState({ tracks: { [TRACK]: { status: "loading", progress: 0 } } });
  });

  afterEach(() => {
    applyDeck.mockRestore();
    (djEngine.applyMixer as unknown as ReturnType<typeof spyOn>).mockRestore();
    useGlobalStore.setState(initialGlobalState, true);
    useDjStore.setState(initialDjState, true);
  });

  it("keeps the clock offset across a reconnect to the same server and applies DJ_STATE with it", () => {
    sendDjState("boot-1");
    completeSync();
    applyDeck.mockClear();
    offsetsSeen = [];

    useGlobalStore.getState().onConnectionReset();
    expect(useGlobalStore.getState().isSynced).toBe(false);
    expect(useGlobalStore.getState().offsetEstimate).toBe(OFFSET_MS);
    // Re-probe from scratch (fast cadence in useNtpHeartbeat)
    expect(useGlobalStore.getState().syncMeasurements).toHaveLength(0);

    sendDjState("boot-1");

    expect(applyDeck).toHaveBeenCalledTimes(2);
    expect(offsetsSeen).toEqual([OFFSET_MS, OFFSET_MS]);
  });

  it("resets the clock when the server restarted and holds DJ_STATE back until re-synced", () => {
    sendDjState("boot-1");
    completeSync();
    useGlobalStore.getState().onConnectionReset();
    applyDeck.mockClear();
    offsetsSeen = [];

    sendDjState("boot-2");

    expect(useGlobalStore.getState().offsetEstimate).toBe(0);
    expect(applyDeck).not.toHaveBeenCalled();

    // A deck change from another DJ while still unsynced is queued too
    dispatchWSResponse({
      response: { type: "ROOM_EVENT", event: { type: "DJ_DECK_STATE", deck: playingDeck("A", 2) } },
      context: context(),
    });
    expect(applyDeck).not.toHaveBeenCalled();

    completeSync(-300);

    // Every deck reconciled once, with the fresh offset and the latest snapshot
    expect(offsetsSeen).toEqual([-300, -300]);
    const appliedA = (applyDeck.mock.calls as unknown[][]).map((c) => c[0] as DeckState).find((d) => d.deckId === "A");
    expect(appliedA?.version).toBe(2);
  });

  it("does not trust the old offset for deck updates that arrive before the new connection's DJ_STATE", () => {
    sendDjState("boot-1");
    completeSync();
    useGlobalStore.getState().onConnectionReset();
    applyDeck.mockClear();

    // Unknown server process yet: could be a restarted one
    useDjStore.getState().applyDeckState(playingDeck("A", 5));

    expect(applyDeck).not.toHaveBeenCalled();
  });
});

describe("isDeckContinuation", () => {
  it("treats an unchanged snapshot as a continuation, even when its anchor lies outside the loop", () => {
    // Re-sent snapshots must never restart a playing voice; wrapping the anchor
    // into the loop would otherwise make the timeline comparison fail
    const deck: DeckState = { ...playingDeck("A"), anchorPositionSec: 40, loop: { startSec: 8, endSec: 16 } };
    expect(isDeckContinuation(deck, { ...deck, version: deck.version + 1 })).toBe(true);
  });

  it("restarts on a seek", () => {
    const deck = playingDeck("A");
    expect(isDeckContinuation(deck, { ...deck, anchorPositionSec: 30, version: 2 })).toBe(false);
  });
});
