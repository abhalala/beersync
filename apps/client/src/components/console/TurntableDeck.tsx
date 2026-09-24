"use client";
import { JogWheel, LcdDisplay, NeuButton, NeuPanel, PadGrid, type JogWheelHandle } from "@/components/neu";
import { cn, extractFileNameFromUrl, trimFileName } from "@/lib/utils";
import { getBeatGrid, getDeckDisplayPosition, useDjStore } from "@/store/dj";
import { useCanDj, useGlobalStore } from "@/store/global";
import type { DeckCommand, DeckId } from "@beatsync/shared";
import { deckRate } from "@beatsync/shared";
import { useRef } from "react";
import { deckColor } from "./Deck";
import { useAnimationFrame } from "./useAnimationFrame";
import { ScrollingWaveform } from "./WaveformView";

const SECONDS_PER_PLATTER_TURN = 1.8; // 33⅓ rpm

/**
 * A large jog wheel/platter with a zoomed waveform above and just the
 * essential transport + hot cues — djay-style: the platter is the hero,
 * everything else stays out of its way.
 */
export const TurntableDeck = ({
  deckId,
  size = 260,
  className,
}: {
  deckId: DeckId;
  size?: number;
  className?: string;
}) => {
  const deck = useDjStore((s) => s.decks[deckId]);
  const tracks = useDjStore((s) => s.tracks);
  const send = useDjStore((s) => s.sendDeckCommand);
  const meta = useGlobalStore((s) => s.audioSources.find((a) => a.source.url === deck.trackUrl)?.source.meta);
  const currentUser = useGlobalStore((s) => s.currentUser);
  const canMutate = useCanDj();
  const jogRef = useRef<JogWheelHandle>(null);

  const color = deckColor(deckId);
  const loaded = deck.status !== "empty" && !!deck.trackUrl;
  const lockedByOther = !!deck.lockedBy && deck.lockedBy.clientId !== currentUser?.clientId && !currentUser?.isAdmin;
  const disabled = !canMutate || lockedByOther;
  const grid = getBeatGrid(deck.trackUrl, tracks);
  const bpm = grid ? grid.bpm * deckRate(deck) : undefined;
  const title = deck.trackUrl
    ? (meta?.title ?? trimFileName(extractFileNameFromUrl(deck.trackUrl)))
    : "No track loaded";
  const cmd = (command: DeckCommand) => send(deckId, command);

  useAnimationFrame(() => {
    if (!deck.trackUrl) return;
    const position = getDeckDisplayPosition(deckId);
    jogRef.current?.setAngle(((position / SECONDS_PER_PLATTER_TURN) * 360) % 360);
  });

  return (
    <NeuPanel
      className={cn("flex min-w-0 flex-col items-center gap-3 p-3 sm:p-4", className)}
      aria-label={`Deck ${deckId}`}
      style={{ ["--deck-color" as string]: color }}
    >
      <div className="w-full min-w-0 text-center">
        <div className="truncate text-sm font-semibold text-[var(--neu-text)]" title={title}>
          {title}
        </div>
        <div className="truncate text-xs text-[var(--neu-muted)]">{meta?.artist ?? ""}</div>
      </div>

      <ScrollingWaveform deckId={deckId} className="h-12 w-full rounded-lg neu-inset-sm" />

      <JogWheel
        ref={jogRef}
        size={size}
        color={color}
        label={`Deck ${deckId} jog wheel`}
        disabled={disabled || !loaded}
        onNudge={(deltaSec) => cmd({ type: "NUDGE", deltaSec })}
      >
        <div className="flex flex-col items-center font-mono text-xs leading-tight text-[var(--neu-muted)]">
          <span style={{ color }} className="text-lg font-bold">
            {bpm ? bpm.toFixed(1) : "—"}
          </span>
          <span>{deck.status === "playing" ? "PLAYING" : loaded ? "PAUSED" : "EMPTY"}</span>
        </div>
      </JogWheel>

      <div className="flex items-center gap-3">
        <LcdDisplay size="sm" label="BPM" value={bpm ? bpm.toFixed(1) : "---.-"} accent={color} />
        <NeuButton
          variant="transport"
          size="lg"
          led={deck.status === "paused" && deck.anchorPositionSec === deck.cuePointSec ? "on" : "off"}
          ledColor="var(--neu-warn)"
          disabled={disabled || !loaded}
          onClick={() => cmd({ type: "CUE" })}
          aria-label={`Deck ${deckId} cue`}
        >
          CUE
        </NeuButton>
        <NeuButton
          variant="transport"
          size="lg"
          led={deck.status === "playing" ? "on" : loaded ? "blink" : "off"}
          ledColor="var(--neu-ok)"
          disabled={disabled || !loaded}
          onClick={() => cmd({ type: deck.status === "playing" ? "PAUSE" : "PLAY" })}
          aria-label={deck.status === "playing" ? `Pause deck ${deckId}` : `Play deck ${deckId}`}
        >
          {deck.status === "playing" ? "❚❚" : "▶"}
        </NeuButton>
      </div>

      <PadGrid
        name={`Deck ${deckId} hot cue`}
        color={color}
        disabled={disabled || !loaded}
        pads={deck.hotCues.map((cue, i) => (cue ? { color: cue.color, label: String.fromCharCode(65 + i) } : null))}
        onPress={(index) => cmd({ type: "JUMP_HOT_CUE", index })}
        onClear={(index) => cmd({ type: "DELETE_HOT_CUE", index })}
      />
    </NeuPanel>
  );
};
