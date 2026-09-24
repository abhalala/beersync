"use client";
import {
  Fader,
  JogWheel,
  LcdDisplay,
  NeuButton,
  NeuPanel,
  NeuToggle,
  PadGrid,
  type JogWheelHandle,
} from "@/components/neu";
import { cn, extractFileNameFromUrl, trimFileName } from "@/lib/utils";
import { getBeatGrid, getDeckDisplayPosition, getTrackMeta, useDjStore } from "@/store/dj";
import { useCanDj, useGlobalStore } from "@/store/global";
import type { DeckCommand, DeckId, TempoRange } from "@beatsync/shared";
import { camelotToKeyName, deckRate, TEMPO_RANGES } from "@beatsync/shared";
import { Lock, LockOpen } from "lucide-react";
import { useRef } from "react";
import { useAnimationFrame } from "./useAnimationFrame";
import { OverviewWaveform } from "./WaveformView";

const SECONDS_PER_PLATTER_TURN = 1.8; // 33⅓ rpm
const LOOP_BEATS = [1, 2, 4, 8, 16] as const;

export const deckColor = (deckId: DeckId) => (deckId === "A" ? "var(--deck-a)" : "var(--deck-b)");

const formatClock = (sec: number) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
};

/** Live elapsed/remaining readout, updated per frame without React renders */
const DeckClock = ({ deckId }: { deckId: DeckId }) => {
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const remainRef = useRef<HTMLSpanElement>(null);
  useAnimationFrame(() => {
    const { decks, tracks } = useDjStore.getState();
    const url = decks[deckId].trackUrl;
    const duration = (url && tracks[url]?.analysis?.durationSec) || getTrackMeta(url)?.durationSec || 0;
    const position = url ? getDeckDisplayPosition(deckId) : 0;
    if (elapsedRef.current) elapsedRef.current.textContent = formatClock(position);
    if (remainRef.current)
      remainRef.current.textContent = duration ? `-${formatClock(duration - position)}` : "--:--.-";
  });
  return (
    <LcdDisplay
      label="Time"
      value={<span ref={elapsedRef}>00:00.0</span>}
      sub={<span ref={remainRef}>--:--.-</span>}
      accent={deckColor(deckId)}
    />
  );
};

export const Deck = ({ deckId, className }: { deckId: DeckId; className?: string }) => {
  const deck = useDjStore((s) => s.decks[deckId]);
  const masterDeck = useDjStore((s) => s.mixer.masterDeck);
  const track = useDjStore((s) => (deck.trackUrl ? s.tracks[deck.trackUrl] : undefined));
  const tracks = useDjStore((s) => s.tracks);
  const send = useDjStore((s) => s.sendDeckCommand);
  const sendMixerPatch = useDjStore((s) => s.sendMixerPatch);
  const claimDeck = useDjStore((s) => s.claimDeck);
  // Re-render when the collection's metadata (shared beat grid, titles) changes
  const meta = useGlobalStore((s) => s.audioSources.find((a) => a.source.url === deck.trackUrl)?.source.meta);
  const currentUser = useGlobalStore((s) => s.currentUser);
  const canMutate = useCanDj();
  const jogRef = useRef<JogWheelHandle>(null);
  const lastPitchSend = useRef(0);

  const color = deckColor(deckId);
  const loaded = deck.status !== "empty" && !!deck.trackUrl;
  const lockedByOther = !!deck.lockedBy && deck.lockedBy.clientId !== currentUser?.clientId && !currentUser?.isAdmin;
  const disabled = !canMutate || lockedByOther;
  const grid = getBeatGrid(deck.trackUrl, tracks);
  const bpm = grid ? grid.bpm * deckRate(deck) : undefined;
  const key = meta?.key ?? track?.analysis?.key;
  const title = deck.trackUrl
    ? (meta?.title ?? trimFileName(extractFileNameFromUrl(deck.trackUrl)))
    : "No track loaded";
  const cmd = (command: DeckCommand) => send(deckId, command);

  useAnimationFrame(() => {
    if (!deck.trackUrl) return;
    const position = getDeckDisplayPosition(deckId);
    jogRef.current?.setAngle(((position / SECONDS_PER_PLATTER_TURN) * 360) % 360);
  });

  const setPitch = (pitchPercent: number, force = false) => {
    // Every tempo move re-anchors the shared timeline, so keep the rate modest while dragging
    const now = performance.now();
    if (!force && now - lastPitchSend.current < 120) return;
    lastPitchSend.current = now;
    cmd({ type: "SET_PITCH", pitchPercent });
  };

  const nextRange = (): TempoRange => {
    const i = TEMPO_RANGES.indexOf(deck.tempoRange);
    return TEMPO_RANGES[(i + 1) % TEMPO_RANGES.length];
  };

  const statusLine = !loaded
    ? "Load a track from the library"
    : track?.status === "loading"
      ? `Downloading ${Math.round((track.progress ?? 0) * 100)}%`
      : track?.status === "error"
        ? `Couldn't load: ${track.error}`
        : !track?.analysis
          ? "Analyzing beat grid and key…"
          : (meta?.artist ?? "");

  return (
    <NeuPanel
      className={cn("flex min-w-0 flex-col gap-3 p-3 sm:p-4", className)}
      aria-label={`Deck ${deckId}`}
      style={{ ["--deck-color" as string]: color }}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="grid size-9 shrink-0 place-items-center rounded-xl font-[family-name:var(--font-display)] text-lg font-bold neu-inset-sm"
          style={{ color }}
        >
          {deckId}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--neu-text)]" title={title}>
            {title}
          </div>
          <div className="truncate text-xs text-[var(--neu-muted)]">{statusLine}</div>
        </div>
        <button
          type="button"
          className="neu-chip flex items-center gap-1 text-[11px]"
          disabled={!canMutate || lockedByOther}
          onClick={() => claimDeck(deckId, !deck.lockedBy)}
          title={deck.lockedBy ? `Claimed by ${deck.lockedBy.username}` : "Claim this deck so only you can operate it"}
        >
          {deck.lockedBy ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
          {deck.lockedBy ? deck.lockedBy.username : "Claim"}
        </button>
      </div>

      {/* Readouts */}
      <div className="grid grid-cols-3 gap-2">
        <DeckClock deckId={deckId} />
        <LcdDisplay
          label="BPM"
          value={bpm ? bpm.toFixed(2) : "---.--"}
          sub={`${deck.pitchPercent >= 0 ? "+" : ""}${deck.pitchPercent.toFixed(2)}% · ±${deck.tempoRange}`}
          accent={color}
        />
        <LcdDisplay label="Key" value={key ?? "--"} sub={key ? (camelotToKeyName(key) ?? "") : ""} accent={color} />
      </div>

      <OverviewWaveform
        deckId={deckId}
        className="h-12 w-full rounded-lg neu-inset-sm"
        onSeek={disabled || !loaded ? undefined : (positionSec) => cmd({ type: "SEEK", positionSec })}
      />

      {/* Jog + pitch */}
      <div className={cn("flex items-center gap-3", deckId === "B" && "flex-row-reverse")}>
        <div className="flex flex-1 justify-center">
          <JogWheel
            ref={jogRef}
            size={176}
            color={color}
            label={`Deck ${deckId} jog wheel`}
            disabled={disabled || !loaded}
            onNudge={(deltaSec) => cmd({ type: "NUDGE", deltaSec })}
          >
            <div className="flex flex-col items-center font-mono text-[11px] leading-tight text-[var(--neu-muted)]">
              <span style={{ color }} className="text-base font-bold">
                {bpm ? bpm.toFixed(1) : "—"}
              </span>
              <span>{deck.status === "playing" ? "PLAYING" : loaded ? "PAUSED" : "EMPTY"}</span>
              {masterDeck === deckId && <span className="text-[var(--neu-warn)]">MASTER</span>}
            </div>
          </JogWheel>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Fader
            orientation="vertical"
            reverse
            centerDetent
            length={176}
            min={-deck.tempoRange}
            max={deck.tempoRange}
            step={0.01}
            defaultValue={0}
            value={deck.pitchPercent}
            color={color}
            label={`Deck ${deckId} tempo`}
            format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`}
            disabled={disabled || !loaded}
            onChange={(v) => setPitch(v)}
            onCommit={(v) => setPitch(v, true)}
          />
          <button
            type="button"
            className="neu-chip font-mono text-[10px]"
            disabled={disabled}
            onClick={() => cmd({ type: "SET_TEMPO_RANGE", range: nextRange() })}
            title="Tempo range"
          >
            ±{deck.tempoRange}%
          </button>
        </div>
      </div>

      {/* Hot cues */}
      <PadGrid
        name={`Deck ${deckId} hot cues`}
        color={color}
        disabled={disabled || !loaded}
        pads={deck.hotCues.map((cue, i) => (cue ? { color: cue.color, label: String.fromCharCode(65 + i) } : null))}
        onPress={(index) => cmd({ type: "JUMP_HOT_CUE", index })}
        onClear={(index) => cmd({ type: "DELETE_HOT_CUE", index })}
      />

      {/* Loops + beat jump */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--neu-muted)]">Loop</span>
        {LOOP_BEATS.map((beats) => {
          const active =
            !!deck.loop && !!grid && Math.abs((deck.loop.endSec - deck.loop.startSec) * (grid.bpm / 60) - beats) < 0.01;
          return (
            <NeuButton
              key={beats}
              size="sm"
              active={active}
              disabled={disabled || !loaded}
              onClick={() => (active ? cmd({ type: "LOOP_EXIT" }) : cmd({ type: "LOOP_AUTO", beats }))}
              aria-label={`${beats} beat loop`}
            >
              {beats}
            </NeuButton>
          );
        })}
        <NeuButton
          size="sm"
          disabled={disabled || !deck.loop}
          onClick={() => cmd({ type: "LOOP_RESIZE", factor: 0.5 })}
          aria-label="Halve loop"
        >
          ½
        </NeuButton>
        <NeuButton
          size="sm"
          disabled={disabled || !deck.loop}
          onClick={() => cmd({ type: "LOOP_RESIZE", factor: 2 })}
          aria-label="Double loop"
        >
          2×
        </NeuButton>
        <NeuButton size="sm" disabled={disabled || !deck.loop} onClick={() => cmd({ type: "LOOP_EXIT" })}>
          Exit
        </NeuButton>
        <span className="mx-1 h-5 w-px bg-[var(--neu-line)]" />
        <NeuButton
          size="sm"
          disabled={disabled || !loaded}
          onClick={() => cmd({ type: "BEAT_JUMP", beats: -4 })}
          aria-label="Jump back 4 beats"
        >
          ◀4
        </NeuButton>
        <NeuButton
          size="sm"
          disabled={disabled || !loaded}
          onClick={() => cmd({ type: "BEAT_JUMP", beats: 4 })}
          aria-label="Jump forward 4 beats"
        >
          4▶
        </NeuButton>
      </div>

      {/* Transport */}
      <div className="flex items-center gap-3">
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
        <div className="ml-auto flex flex-wrap justify-end gap-1.5">
          <NeuButton
            size="sm"
            disabled={disabled || !loaded || !grid}
            onClick={() => cmd({ type: "SYNC" })}
            ledColor={color}
          >
            SYNC
          </NeuButton>
          <NeuButton
            size="sm"
            active={masterDeck === deckId}
            led={masterDeck === deckId ? "on" : "off"}
            ledColor="var(--neu-warn)"
            disabled={disabled || !loaded}
            onClick={() => sendMixerPatch({ masterDeck: deckId })}
          >
            MASTER
          </NeuButton>
          <NeuToggle
            label="Quantize"
            checked={deck.quantize}
            disabled={disabled}
            ledColor={color}
            onCheckedChange={(enabled) => cmd({ type: "SET_QUANTIZE", enabled })}
          />
        </div>
      </div>
      {deck.lastActor && (
        <div className="-mt-1 text-right text-[10px] text-[var(--neu-muted)]">
          Last touched by {deck.lastActor.username}
        </div>
      )}
    </NeuPanel>
  );
};
