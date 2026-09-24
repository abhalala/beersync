import type { DeckId, DeckState, MixerState } from "../types/dj";
import { HOT_CUE_COUNT } from "../types/dj";
import { DEFAULT_MIXER_CHANNEL } from "./mixer";

export const createEmptyDeck = (deckId: DeckId): DeckState => ({
  deckId,
  trackUrl: null,
  status: "empty",
  anchorServerTime: 0,
  anchorPositionSec: 0,
  pitchPercent: 0,
  tempoRange: 10,
  cuePointSec: 0,
  hotCues: Array.from({ length: HOT_CUE_COUNT }, () => null),
  loop: null,
  quantize: true,
  version: 0,
  lastActor: null,
  lockedBy: null,
});

export const createDefaultMixer = (): MixerState => ({
  channels: {
    A: { ...DEFAULT_MIXER_CHANNEL, crossfaderAssign: "A" },
    B: { ...DEFAULT_MIXER_CHANNEL, crossfaderAssign: "B" },
  },
  crossfader: 0,
  crossfaderCurve: "smooth",
  masterDeck: null,
  version: 0,
  lastActor: null,
});
