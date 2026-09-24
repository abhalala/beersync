"use client";
import { NeuButton } from "@/components/neu";
import { useState } from "react";
import { Library } from "../Library";
import { Mixer } from "../Mixer";
import { TurntableDeck } from "../TurntableDeck";

/**
 * djay-style arrangement: two large jog wheels front and centre (each with
 * its own zoomed waveform above), mixer between them, library collapsible
 * below so the platters stay the focus.
 */
export const TurntableLayout = () => {
  const [libraryOpen, setLibraryOpen] = useState(true);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
        <TurntableDeck deckId="A" size={260} />
        <Mixer />
        <TurntableDeck deckId="B" size={260} />
      </div>
      <div className="flex shrink-0 items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--neu-muted)]">Library</span>
        <NeuButton size="sm" onClick={() => setLibraryOpen((open) => !open)} aria-expanded={libraryOpen}>
          {libraryOpen ? "Hide" : "Show"}
        </NeuButton>
      </div>
      {libraryOpen && <Library className="min-h-[12rem] flex-1" />}
    </div>
  );
};
