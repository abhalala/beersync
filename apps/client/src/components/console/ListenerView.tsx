"use client";
import { cn, extractFileNameFromUrl, trimFileName } from "@/lib/utils";
import { getBeatGrid, getTrackMeta, useDjStore } from "@/store/dj";
import { useGlobalStore } from "@/store/global";
import { useSeshStore } from "@/store/sesh";
import type { DeckId } from "@beatsync/shared";
import { camelotToKeyName, channelOutputGain, deckRate, REACTION_EMOJIS } from "@beatsync/shared";
import { Disc3, Hand } from "lucide-react";
import { deckColor } from "./Deck";
import { ScrollingWaveform } from "./WaveformView";

/** How loud each deck is in the room right now (0..1), from the shared mixer state */
const useAudibleDecks = (): { deckId: DeckId; level: number }[] => {
  const decks = useDjStore((s) => s.decks);
  const mixer = useDjStore((s) => s.mixer);
  return (["A", "B"] as const)
    .map((deckId) => ({
      deckId,
      level: decks[deckId].status === "playing" ? Math.min(1, channelOutputGain(mixer.channels[deckId], mixer)) : 0,
    }))
    .filter((d) => d.level > 0.03)
    .sort((a, b) => b.level - a.level);
};

const NowPlayingCard = ({ deckId, level, primary }: { deckId: DeckId; level: number; primary: boolean }) => {
  const deck = useDjStore((s) => s.decks[deckId]);
  const tracks = useDjStore((s) => s.tracks);
  // Subscribe to the collection so titles/analysis update live
  useGlobalStore((s) => s.audioSources);
  const meta = getTrackMeta(deck.trackUrl);
  const grid = getBeatGrid(deck.trackUrl, tracks);
  const key = meta?.key ?? (deck.trackUrl ? tracks[deck.trackUrl]?.analysis?.key : undefined);
  const title = deck.trackUrl ? (meta?.title ?? trimFileName(extractFileNameFromUrl(deck.trackUrl))) : "";
  const color = deckColor(deckId);

  return (
    <div className={cn("neu-popover flex items-center gap-4 p-4", primary ? "sm:p-5" : "opacity-80")}>
      {meta?.artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={meta.artworkUrl}
          alt=""
          className={cn("rounded-xl object-cover shadow-lg", primary ? "size-24 sm:size-32" : "size-14")}
        />
      ) : (
        <div
          className={cn(
            "grid shrink-0 place-items-center rounded-xl neu-inset-sm",
            primary ? "size-24 sm:size-32" : "size-14"
          )}
        >
          <Disc3
            className={cn(
              "animate-spin text-[var(--neu-muted)] [animation-duration:3s]",
              primary ? "size-10" : "size-6"
            )}
            style={{ color }}
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color }}>
          Deck {deckId} · {Math.round(level * 100)}% in the mix
        </div>
        <div className={cn("truncate font-semibold", primary ? "text-xl sm:text-2xl" : "text-base")}>{title}</div>
        {meta?.artist && <div className="truncate text-sm text-[var(--neu-muted)]">{meta.artist}</div>}
        <div className="mt-1 flex gap-3 font-mono text-xs text-[var(--neu-muted)]">
          {grid && <span>{(grid.bpm * deckRate(deck)).toFixed(1)} BPM</span>}
          {key && (
            <span>
              {key} · {camelotToKeyName(key)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export const ReactionBar = ({ className }: { className?: string }) => {
  const sendReaction = useSeshStore((s) => s.sendReaction);
  return (
    <div className={cn("flex flex-wrap justify-center gap-2", className)} role="group" aria-label="Send a reaction">
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => sendReaction(emoji)}
          className="neu-chip size-11 justify-center p-0 text-xl active:scale-95"
          aria-label={`React ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
};

/** Reactions from everyone in the sesh drifting up the screen */
export const ReactionOverlay = () => {
  const reactions = useSeshStore((s) => s.reactions);
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden>
      {reactions.map((r) => (
        <div
          key={r.id}
          className="sesh-rise absolute bottom-24 flex flex-col items-center"
          // Spread reactions across the width deterministically by id
          style={{ left: `${10 + ((r.id * 37) % 80)}%` }}
        >
          <span className="text-3xl drop-shadow">{r.emoji}</span>
          <span className="rounded bg-black/40 px-1 text-[10px] text-white">{r.username}</span>
        </div>
      ))}
    </div>
  );
};

export const ListenerView = ({ onOpenDecks }: { onOpenDecks?: () => void }) => {
  const audible = useAudibleDecks();
  const me = useGlobalStore((s) => s.currentUser);
  const requestBeer = useSeshStore((s) => s.requestBeer);
  const anyLoaded = useDjStore((s) => s.decks.A.trackUrl || s.decks.B.trackUrl);

  return (
    <main className="flex min-h-0 flex-1 flex-col items-center gap-5 overflow-y-auto p-4 pb-28 sm:p-8">
      <div className="flex w-full max-w-2xl flex-col gap-3">
        {audible.length === 0 ? (
          <div className="neu-popover p-6 text-center">
            <div className="font-[family-name:var(--font-display)] text-lg font-semibold">
              {anyLoaded ? "The DJs are cueing up…" : "Waiting for the first track"}
            </div>
            <p className="mx-auto mt-1 max-w-md text-sm text-[var(--neu-muted)]">
              Every device in this sesh plays the same mix in sync. Keep this tab open and turn it up.
            </p>
          </div>
        ) : (
          audible.map((d, i) => <NowPlayingCard key={d.deckId} deckId={d.deckId} level={d.level} primary={i === 0} />)
        )}
      </div>

      {/* Live waveforms of the decks */}
      <div className="neu-well flex w-full max-w-2xl flex-col gap-1 p-1.5">
        <ScrollingWaveform deckId="A" className="h-12 w-full" />
        <ScrollingWaveform deckId="B" className="h-12 w-full" />
      </div>

      <ReactionBar />

      <div className="flex flex-wrap justify-center gap-2">
        {onOpenDecks ? (
          <button type="button" className="neu-chip px-4 py-2 text-sm" onClick={onOpenDecks}>
            Back to the decks
          </button>
        ) : (
          <button type="button" className="neu-chip px-4 py-2 text-sm" onClick={() => requestBeer(!me?.wantsBeer)}>
            <Hand className="size-4" />
            {me?.wantsBeer ? "Waiting for a beer… (cancel)" : "Ask for a beer to join the decks"}
          </button>
        )}
      </div>
    </main>
  );
};
