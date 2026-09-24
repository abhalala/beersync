"use client";
import { Fader, NeuPanel } from "@/components/neu";
import { useCanDj } from "@/store/global";
import { useDjStore } from "@/store/dj";
import { deckColor } from "../Deck";
import { DeckStrip } from "../DeckStrip";
import { Library } from "../Library";
import { ScrollingWaveform } from "../WaveformView";

/** Crossfader-only strip, standing in for a full Mixer when the library needs the room */
const MinimalMixer = () => {
  const crossfader = useDjStore((s) => s.mixer.crossfader);
  const sendMixerPatch = useDjStore((s) => s.sendMixerPatch);
  const canMutate = useCanDj();

  return (
    <NeuPanel className="flex w-full flex-col items-center gap-1 p-2" aria-label="Mixer">
      <Fader
        orientation="horizontal"
        centerDetent
        length="100%"
        min={-1}
        max={1}
        step={0.002}
        defaultValue={0}
        value={crossfader}
        color="var(--neu-text)"
        label="Crossfader"
        format={(v) =>
          Math.abs(v) < 0.01 ? "Centre" : v < 0 ? `A ${Math.round(-v * 100)}` : `B ${Math.round(v * 100)}`
        }
        disabled={!canMutate}
        onChange={(v) => sendMixerPatch({ crossfader: v })}
        onCommit={(v) => sendMixerPatch({ crossfader: v })}
        className="w-full max-w-[24rem]"
      />
      <div className="flex w-full max-w-[24rem] justify-between font-mono text-[10px]">
        <span style={{ color: deckColor("A") }}>A</span>
        <span className="text-[var(--neu-muted)]">X-FADER</span>
        <span style={{ color: deckColor("B") }}>B</span>
      </div>
    </NeuPanel>
  );
};

/**
 * rekordbox browse-style arrangement: the library takes most of the screen,
 * slim deck strips with small waveforms up top, a crossfader-only mixer.
 */
export const BrowseLayout = () => (
  <div className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="grid shrink-0 grid-cols-2 gap-3">
      <div className="flex flex-col gap-1.5">
        <DeckStrip deckId="A" />
        <ScrollingWaveform deckId="A" className="h-8 w-full rounded-lg neu-inset-sm" />
      </div>
      <div className="flex flex-col gap-1.5">
        <DeckStrip deckId="B" />
        <ScrollingWaveform deckId="B" className="h-8 w-full rounded-lg neu-inset-sm" />
      </div>
    </div>
    <MinimalMixer />
    <Library className="min-h-[20rem] flex-1" />
  </div>
);
