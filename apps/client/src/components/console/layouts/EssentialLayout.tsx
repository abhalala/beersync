"use client";
import { Deck } from "../Deck";
import { Library } from "../Library";
import { Mixer } from "../Mixer";

/**
 * Traktor-style arrangement: two full deck panels (each with its own
 * waveform, transport and pads built in) flanking a centre mixer, library
 * underneath.
 */
export const EssentialLayout = () => (
  <div className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
      <Deck deckId="A" />
      <Mixer />
      <Deck deckId="B" />
    </div>
    <Library className="min-h-[14rem] flex-1" />
  </div>
);
