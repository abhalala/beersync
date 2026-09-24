"use client";
import { NeuPanel } from "@/components/neu";
import { CompactTransport } from "../CompactTransport";
import { DeckStrip } from "../DeckStrip";
import { Library } from "../Library";
import { Mixer } from "../Mixer";
import { VerticalWaveform } from "../VerticalWaveform";

/**
 * Serato-style arrangement: compact deck info strips up top, two parallel
 * vertical waveforms scrolling top→bottom in the centre, compact
 * transport/pads under each, mixer centre-bottom, library below.
 */
export const VerticalLayout = () => (
  <div className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="grid shrink-0 grid-cols-2 gap-3">
      <DeckStrip deckId="A" />
      <DeckStrip deckId="B" />
    </div>
    <NeuPanel className="grid shrink-0 grid-cols-2 gap-2 p-2" variant="inset">
      <VerticalWaveform deckId="A" className="h-64 w-full rounded-lg" />
      <VerticalWaveform deckId="B" className="h-64 w-full rounded-lg" />
    </NeuPanel>
    <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-start gap-3">
      <CompactTransport deckId="A" />
      <Mixer />
      <CompactTransport deckId="B" />
    </div>
    <Library className="min-h-[14rem] flex-1" />
  </div>
);
