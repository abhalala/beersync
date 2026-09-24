"use client";
import { LcdDisplay, NeuPanel } from "@/components/neu";
import { cn, extractFileNameFromUrl, trimFileName } from "@/lib/utils";
import { getBeatGrid, getDeckDisplayPosition, useDjStore } from "@/store/dj";
import { useGlobalStore } from "@/store/global";
import type { DeckId } from "@beatsync/shared";
import { camelotToKeyName, deckRate } from "@beatsync/shared";
import { useRef } from "react";
import { deckColor } from "./Deck";
import { useAnimationFrame } from "./useAnimationFrame";

const formatClock = (sec: number) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
};

/** Live elapsed time readout, updated per frame without React renders */
const StripClock = ({ deckId }: { deckId: DeckId }) => {
  const ref = useRef<HTMLSpanElement>(null);
  useAnimationFrame(() => {
    const { decks } = useDjStore.getState();
    const position = decks[deckId].trackUrl ? getDeckDisplayPosition(deckId) : 0;
    if (ref.current) ref.current.textContent = formatClock(position);
  });
  return <span ref={ref}>00:00.0</span>;
};

/**
 * A compact, one-line deck header — title/artist, BPM, key, time — for
 * layouts that keep the full deck panel elsewhere (or don't have one).
 * Serato/Traktor-style track info strip.
 */
export const DeckStrip = ({ deckId, className }: { deckId: DeckId; className?: string }) => {
  const deck = useDjStore((s) => s.decks[deckId]);
  const tracks = useDjStore((s) => s.tracks);
  const meta = useGlobalStore((s) => s.audioSources.find((a) => a.source.url === deck.trackUrl)?.source.meta);
  const track = useDjStore((s) => (deck.trackUrl ? s.tracks[deck.trackUrl] : undefined));
  const color = deckColor(deckId);
  const grid = getBeatGrid(deck.trackUrl, tracks);
  const bpm = grid ? grid.bpm * deckRate(deck) : undefined;
  const key = meta?.key ?? track?.analysis?.key;
  const title = deck.trackUrl
    ? (meta?.title ?? trimFileName(extractFileNameFromUrl(deck.trackUrl)))
    : "No track loaded";

  return (
    <NeuPanel
      className={cn("flex min-w-0 items-center gap-2 p-2", className)}
      aria-label={`Deck ${deckId} info`}
      style={{ ["--deck-color" as string]: color }}
    >
      <div
        className="grid size-7 shrink-0 place-items-center rounded-lg font-[family-name:var(--font-display)] text-sm font-bold neu-inset-sm"
        style={{ color }}
      >
        {deckId}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-[var(--neu-text)]" title={title}>
          {title}
        </div>
        <div className="truncate text-[10px] text-[var(--neu-muted)]">{meta?.artist ?? ""}</div>
      </div>
      <LcdDisplay size="sm" label="BPM" value={bpm ? bpm.toFixed(1) : "---.-"} accent={color} />
      <LcdDisplay size="sm" label="Key" value={key ? (camelotToKeyName(key) ?? key) : "--"} accent={color} />
      <LcdDisplay size="sm" label="Time" value={<StripClock deckId={deckId} />} accent={color} />
    </NeuPanel>
  );
};
