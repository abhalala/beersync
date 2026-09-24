import { djEngine } from "@/lib/dj/engine";
import { getBrowseTarget } from "@/lib/midi/browse";
import {
  createFlx4DecoderState,
  decodeFlx4,
  flx4LedMessages,
  tempoPositionToPitch,
  type Flx4Intent,
  type MidiMessage,
} from "@/lib/midi/flx4";
import { useDjStore } from "@/store/dj";
import type { DeckId } from "@beatsync/shared";
import { TEMPO_RANGES } from "@beatsync/shared";
import { create } from "zustand";

// Web MIDI bridge for the Pioneer DDJ-FLX4. Hardware moves become the same
// deck commands and mixer patches the on-screen controls send, so the server
// still decides (and beer-holder permissions still apply).

type Status = "unsupported" | "idle" | "connecting" | "connected" | "not-found" | "denied";

interface MidiState {
  status: Status;
  deviceName: string | null;
  /** Flip if the tempo fader runs the wrong way on your unit */
  invertTempo: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  setInvertTempo: (invert: boolean) => void;
}

const DEVICE_PATTERN = /DDJ-?FLX4/i;
const JOG_FLUSH_MS = 40;
const PITCH_SEND_INTERVAL_MS = 120;
const LED_INTERVAL_MS = 50;
/** Tempo fader soft takeover: ignore the fader until it comes within this many % of the deck */
const TAKEOVER_WINDOW_PERCENT = 0.3;

// Seconds of playhead movement per jog tick
const JOG_SECONDS = { bend: 0.0006, platter: 0.0025, search: 0.08 } as const;

let access: MIDIAccess | null = null;
let input: MIDIInput | null = null;
let output: MIDIOutput | null = null;
let decoder = createFlx4DecoderState();
let ledTimer: ReturnType<typeof setInterval> | null = null;
const sentLeds = new Map<string, number>();
const jogAccum: Record<DeckId, number> = { A: 0, B: 0 };
let jogTimer: ReturnType<typeof setTimeout> | null = null;
const lastPitchSend: Record<DeckId, number> = { A: 0, B: 0 };
const tempoLocked: Record<DeckId, boolean> = { A: true, B: true };
const lastSentPitch: Partial<Record<DeckId, number>> = {};

const send = (message: MidiMessage) => {
  try {
    output?.send(message);
  } catch {
    // Device unplugged mid-send
  }
};

const flushJog = () => {
  jogTimer = null;
  const { sendDeckCommand } = useDjStore.getState();
  for (const deckId of ["A", "B"] as const) {
    const deltaSec = jogAccum[deckId];
    jogAccum[deckId] = 0;
    if (Math.abs(deltaSec) < 0.0005) continue;
    sendDeckCommand(deckId, { type: "NUDGE", deltaSec: Math.max(-2, Math.min(2, deltaSec)) });
  }
};

const handleTempo = (deckId: DeckId, position: number) => {
  const deck = useDjStore.getState().decks[deckId];
  const signed = useMidiStore.getState().invertTempo ? 1 - position : position;
  const pitch = tempoPositionToPitch(signed, deck.tempoRange);
  // Soft takeover: after SYNC, a range change, or another DJ moving the tempo, the deck no
  // longer matches the physical fader; don't jump it until the fader is brought back
  const sent = lastSentPitch[deckId];
  const settled = performance.now() - lastPitchSend[deckId] > 500;
  if (sent !== undefined && settled && Math.abs(deck.pitchPercent - sent) > TAKEOVER_WINDOW_PERCENT) {
    tempoLocked[deckId] = true;
  }
  if (tempoLocked[deckId]) {
    if (Math.abs(pitch - deck.pitchPercent) > TAKEOVER_WINDOW_PERCENT) return;
    tempoLocked[deckId] = false;
  }
  const now = performance.now();
  if (now - lastPitchSend[deckId] < PITCH_SEND_INTERVAL_MS) return;
  lastPitchSend[deckId] = now;
  lastSentPitch[deckId] = pitch;
  useDjStore.getState().sendDeckCommand(deckId, { type: "SET_PITCH", pitchPercent: pitch });
};

export const applyFlx4Intent = (intent: Flx4Intent) => {
  const { decks, sendDeckCommand, sendMixerPatch } = useDjStore.getState();
  switch (intent.kind) {
    case "deck":
      if (intent.command.type === "SYNC") tempoLocked[intent.deckId] = true;
      return sendDeckCommand(intent.deckId, intent.command);
    case "togglePlay":
      return sendDeckCommand(intent.deckId, { type: decks[intent.deckId].status === "playing" ? "PAUSE" : "PLAY" });
    case "toggleLoop":
      return sendDeckCommand(
        intent.deckId,
        decks[intent.deckId].loop ? { type: "LOOP_EXIT" } : { type: "LOOP_AUTO", beats: 4 }
      );
    case "toggleQuantize":
      return sendDeckCommand(intent.deckId, { type: "SET_QUANTIZE", enabled: !decks[intent.deckId].quantize });
    case "cycleTempoRange": {
      const i = TEMPO_RANGES.indexOf(decks[intent.deckId].tempoRange);
      tempoLocked[intent.deckId] = true;
      return sendDeckCommand(intent.deckId, {
        type: "SET_TEMPO_RANGE",
        range: TEMPO_RANGES[(i + 1) % TEMPO_RANGES.length],
      });
    }
    case "setMaster":
      return sendMixerPatch({ masterDeck: intent.deckId });
    case "jumpToStart":
      return sendDeckCommand(intent.deckId, { type: "SEEK", positionSec: 0 });
    case "tempo":
      return handleTempo(intent.deckId, intent.position);
    case "jog": {
      const playing = decks[intent.deckId].status === "playing";
      const perTick = intent.mode === "platter" && playing ? JOG_SECONDS.bend : JOG_SECONDS[intent.mode];
      jogAccum[intent.deckId] += intent.ticks * perTick;
      if (!jogTimer) jogTimer = setTimeout(flushJog, JOG_FLUSH_MS);
      return;
    }
    case "jogTouch":
      return;
    case "mixer":
      return sendMixerPatch(intent.patch);
    case "browse":
      return getBrowseTarget()?.move(intent.delta);
    case "load":
      return getBrowseTarget()?.load(intent.deckId);
  }
};

const updateLeds = () => {
  if (!output) return;
  const { decks } = useDjStore.getState();
  const deckLeds = (deckId: DeckId) => {
    const d = decks[deckId];
    return {
      playing: d.status === "playing",
      loaded: d.status !== "empty",
      atCue: Math.abs(d.anchorPositionSec - d.cuePointSec) < 0.01,
      looping: !!d.loop,
      hotCues: d.hotCues.map((c) => !!c),
      level: djEngine.getLevel(deckId),
    };
  };
  for (const [status, d1, d2] of flx4LedMessages({ decks: { A: deckLeds("A"), B: deckLeds("B") } })) {
    const key = `${status}:${d1}`;
    if (sentLeds.get(key) === d2) continue;
    sentLeds.set(key, d2);
    send([status, d1, d2]);
  }
};

const attach = (midi: MIDIAccess) => {
  const findPort = <T extends MIDIPort>(ports: Map<string, T>) =>
    [...ports.values()].find((p) => DEVICE_PATTERN.test(p.name ?? "")) ?? null;
  const nextInput = findPort(midi.inputs as unknown as Map<string, MIDIInput>);
  const nextOutput = findPort(midi.outputs as unknown as Map<string, MIDIOutput>);

  if (input && input !== nextInput) input.onmidimessage = null;
  input = nextInput;
  output = nextOutput;
  decoder = createFlx4DecoderState();
  sentLeds.clear();
  tempoLocked.A = tempoLocked.B = true;

  if (!input) {
    useMidiStore.setState({ status: "not-found", deviceName: null });
    return;
  }
  input.onmidimessage = (event) => {
    if (!event.data) return;
    for (const intent of decodeFlx4(decoder, event.data)) applyFlx4Intent(intent);
  };
  // "Track loaded" LED animation on both decks, as a hello
  send([0x9f, 0x00, 0x7f]);
  send([0x9f, 0x01, 0x7f]);
  if (!ledTimer) ledTimer = setInterval(updateLeds, LED_INTERVAL_MS);
  useMidiStore.setState({ status: "connected", deviceName: input.name ?? "DDJ-FLX4" });
};

export const useMidiStore = create<MidiState>((set, get) => ({
  status: typeof navigator !== "undefined" && "requestMIDIAccess" in navigator ? "idle" : "unsupported",
  deviceName: null,
  invertTempo: false,

  connect: async () => {
    if (get().status === "unsupported") return;
    set({ status: "connecting" });
    try {
      access = access ?? (await navigator.requestMIDIAccess({ sysex: false }));
      access.onstatechange = () => access && attach(access);
      attach(access);
    } catch {
      set({ status: "denied" });
    }
  },

  disconnect: () => {
    if (input) input.onmidimessage = null;
    // Turn every LED we lit back off
    for (const [key, value] of sentLeds) {
      if (value === 0) continue;
      const [status, d1] = key.split(":").map(Number);
      send([status, d1, 0]);
    }
    if (ledTimer) clearInterval(ledTimer);
    ledTimer = null;
    if (access) access.onstatechange = null;
    input = null;
    output = null;
    sentLeds.clear();
    set({ status: "idle", deviceName: null });
  },

  setInvertTempo: (invertTempo) => {
    tempoLocked.A = tempoLocked.B = true;
    set({ invertTempo });
  },
}));
