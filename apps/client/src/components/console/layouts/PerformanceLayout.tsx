"use client";
import { Deck } from "../Deck";
import { Library } from "../Library";
import { Mixer } from "../Mixer";
import { ScrollingWaveform } from "../WaveformView";

/**
 * rekordbox-style arrangement: stacked zoomed waveforms up top, Deck A |
 * Mixer | Deck B in a row, library filling the rest.
 */
export const PerformanceLayout = () => (
  <div className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="neu-well flex shrink-0 flex-col gap-1 p-1.5">
      <ScrollingWaveform deckId="A" className="h-14 w-full sm:h-16" />
      <ScrollingWaveform deckId="B" className="h-14 w-full sm:h-16" />
    </div>
    <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3">
      <Deck deckId="A" />
      <Mixer />
      <Deck deckId="B" />
    </div>
    <Library className="min-h-[14rem] flex-1" />
  </div>
);
