"use client";
import { Chat } from "@/components/dashboard/right/Chat";
import { ConnectedUsersList } from "@/components/dashboard/ConnectedUsersList";
import { RoomQRCode } from "@/components/dashboard/CopyRoom";
import { PlaybackPermissions } from "@/components/dashboard/PlaybackPermissions";
import { SyncProgress } from "@/components/ui/SyncProgress";
import { cn } from "@/lib/utils";
import { useDjStore } from "@/store/dj";
import { useCanDj, useGlobalStore } from "@/store/global";
import { useState } from "react";
import { ConsoleTopBar } from "./ConsoleTopBar";
import { Deck } from "./Deck";
import { Library } from "./Library";
import { ListenerView, ReactionBar, ReactionOverlay } from "./ListenerView";
import { Mixer } from "./Mixer";
import { SeshMinimap } from "./SeshMinimap";
import { useDeckShortcuts } from "./useDeckShortcuts";
import { useNeuTheme } from "./useNeuTheme";
import { ScrollingWaveform } from "./WaveformView";

type MobileTab = "A" | "mixer" | "B" | "library";

const MOBILE_TABS: { id: MobileTab; label: string }[] = [
  { id: "A", label: "Deck A" },
  { id: "mixer", label: "Mixer" },
  { id: "B", label: "Deck B" },
  { id: "library", label: "Library" },
];

export const Console = ({ roomId }: { roomId: string }) => {
  const isSynced = useGlobalStore((s) => s.isSynced);
  const isInitingSystem = useGlobalStore((s) => s.isInitingSystem);
  const hasDjState = useDjStore((s) => s.hasState);
  const [tab, setTab] = useState<MobileTab>("A");
  const [crewOpen, setCrewOpen] = useState(false);
  const [theme, toggleTheme] = useNeuTheme();
  const canDj = useCanDj();
  const [listening, setListening] = useState(false);
  const showDecks = canDj && !listening;
  useDeckShortcuts(showDecks);

  const isReady = isSynced && !isInitingSystem;

  return (
    <div
      className="neu relative flex h-dvh flex-col overflow-hidden bg-[var(--neu-bg)] text-[var(--neu-text)]"
      data-theme={theme}
    >
      <ConsoleTopBar
        roomId={roomId}
        theme={theme}
        onToggleTheme={toggleTheme}
        crewOpen={crewOpen}
        onToggleCrew={() => setCrewOpen((open) => !open)}
        view={canDj ? (listening ? "listener" : "decks") : undefined}
        onToggleView={() => setListening((l) => !l)}
      />

      {/* Crew: people, DJ permissions, invite QR and chat (Beatsync's room tools) */}
      {crewOpen && (
        <aside
          className="absolute top-12 right-0 bottom-0 z-40 flex w-full max-w-sm flex-col gap-3 overflow-y-auto bg-neutral-950/95 p-3 text-white shadow-2xl backdrop-blur"
          aria-label="Crew"
        >
          <PlaybackPermissions />
          <ConnectedUsersList />
          <RoomQRCode />
          <div className="min-h-[20rem] flex-1">
            <Chat />
          </div>
        </aside>
      )}

      {/* Start gate (reuses Beatsync's clock sync + "start audio" gesture) */}
      {!isReady && <SyncProgress />}

      {isReady && !showDecks && <ListenerView onOpenDecks={canDj ? () => setListening(false) : undefined} />}

      {isReady && showDecks && (
        <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-2 sm:p-3">
          {!hasDjState && <div className="text-center text-xs text-[var(--neu-muted)]">Connecting to the decks…</div>}

          {/* Stacked zoomed waveforms, rekordbox style */}
          <div className="neu-well flex shrink-0 flex-col gap-1 p-1.5">
            <ScrollingWaveform deckId="A" className="h-14 w-full sm:h-16" />
            <ScrollingWaveform deckId="B" className="h-14 w-full sm:h-16" />
          </div>

          {/* Desktop: decks around the mixer, library below */}
          <div className="hidden min-h-0 flex-1 flex-col gap-3 lg:flex">
            <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3">
              <Deck deckId="A" />
              <Mixer />
              <Deck deckId="B" />
            </div>
            <Library className="min-h-[14rem] flex-1" />
          </div>

          {/* Phone / tablet: one section at a time */}
          <div className="flex min-h-0 flex-1 flex-col gap-2 lg:hidden">
            <div role="tablist" aria-label="Console sections" className="grid shrink-0 grid-cols-4 gap-2">
              {MOBILE_TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  type="button"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "neu-chip justify-center py-2 text-xs font-semibold",
                    tab === t.id && "neu-inset-sm",
                    t.id === "A" && "text-[var(--deck-a)]",
                    t.id === "B" && "text-[var(--deck-b)]"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-safe">
              {tab === "A" && <Deck deckId="A" />}
              {tab === "B" && <Deck deckId="B" />}
              {tab === "mixer" && <Mixer />}
              {tab === "library" && <Library className="h-full min-h-[24rem]" />}
            </div>
          </div>
        </main>
      )}
      {isReady && <ReactionOverlay />}
      {isReady && (
        <div className="pointer-events-none absolute right-3 bottom-3 z-40 flex flex-col items-end gap-2 pb-safe">
          {showDecks && <ReactionBar className="pointer-events-auto hidden xl:flex" />}
          <SeshMinimap />
        </div>
      )}
    </div>
  );
};
