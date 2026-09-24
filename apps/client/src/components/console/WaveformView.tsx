"use client";
import type { Waveform } from "@/lib/dj/analysis";
import { getBeatGrid, getDeckDisplayPosition, getTrackMeta, useDjStore } from "@/store/dj";
import type { DeckId } from "@beatsync/shared";
import { beatLengthSec } from "@beatsync/shared";
import { useRef } from "react";
import { fitCanvas, useAnimationFrame } from "./useAnimationFrame";

// rekordbox-style 3-band colours: lows blue, mids amber, highs white
const LOW_COLOR = "rgba(52, 110, 255, 0.95)";
const MID_COLOR = "rgba(243, 165, 61, 0.9)";
const HIGH_COLOR = "rgba(240, 244, 250, 0.9)";

const deckAccent = (deckId: DeckId) => (deckId === "A" ? "#3ccbe2" : "#f3a53d");

/** Draw one waveform column (three stacked, mirrored bands) */
const drawColumn = (
  ctx: CanvasRenderingContext2D,
  wf: Waveform,
  bucket: number,
  x: number,
  w: number,
  mid: number,
  half: number
) => {
  const low = wf.low[bucket] / 255;
  const m = wf.mid[bucket] / 255;
  const high = wf.high[bucket] / 255;
  ctx.fillStyle = LOW_COLOR;
  ctx.fillRect(x, mid - low * half, w, low * half * 2);
  ctx.fillStyle = MID_COLOR;
  ctx.fillRect(x, mid - m * half * 0.8, w, m * half * 1.6);
  ctx.fillStyle = HIGH_COLOR;
  ctx.fillRect(x, mid - high * half * 0.55, w, high * half * 1.1);
};

interface WaveformViewProps {
  deckId: DeckId;
  /** Seconds of audio visible across the width */
  windowSec?: number;
  className?: string;
}

/** Zoomed, scrolling waveform with the playhead fixed in the centre */
export const ScrollingWaveform = ({ deckId, windowSec = 8, className }: WaveformViewProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height, dpr } = fitCanvas(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const { decks, tracks } = useDjStore.getState();
    const deck = decks[deckId];
    const url = deck.trackUrl;
    const wf = url ? tracks[url]?.analysis?.waveform : undefined;
    const mid = height / 2;
    const accent = deckAccent(deckId);

    if (!url || !wf) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(0, mid - 0.5, width, 1);
      return;
    }

    const position = getDeckDisplayPosition(deckId);
    const pxPerSec = width / windowSec;
    const startSec = position - windowSec / 2;
    const half = height / 2 - 4;

    // Loop region
    if (deck.loop) {
      const x0 = (deck.loop.startSec - startSec) * pxPerSec;
      const x1 = (deck.loop.endSec - startSec) * pxPerSec;
      ctx.fillStyle = "rgba(90, 211, 140, 0.16)";
      ctx.fillRect(x0, 0, x1 - x0, height);
    }

    // Waveform columns (2 CSS px wide)
    const colWidth = 2;
    for (let x = 0; x < width; x += colWidth) {
      const t = startSec + x / pxPerSec;
      if (t < 0) continue;
      const bucket = Math.floor(t * wf.bucketsPerSecond);
      if (bucket >= wf.low.length) break;
      drawColumn(ctx, wf, bucket, x, colWidth - 0.5, mid, half);
    }

    // Beat grid: every beat faint, every bar (4 beats) bright
    const grid = getBeatGrid(url, tracks);
    if (grid) {
      const beatLen = beatLengthSec(grid.bpm);
      const first = Math.ceil((startSec - grid.firstBeatSec) / beatLen);
      const last = Math.floor((startSec + windowSec - grid.firstBeatSec) / beatLen);
      for (let i = first; i <= last; i++) {
        const x = Math.round((grid.firstBeatSec + i * beatLen - startSec) * pxPerSec) + 0.5;
        const isBar = ((i % 4) + 4) % 4 === 0;
        ctx.fillStyle = isBar ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.16)";
        ctx.fillRect(x, 0, 1, isBar ? height : 8);
        if (!isBar) ctx.fillRect(x, height - 8, 1, 8);
      }
    }

    // Memory cue + hot cues
    const marker = (sec: number, color: string, label?: string) => {
      const x = (sec - startSec) * pxPerSec;
      if (x < -10 || x > width + 10) return;
      ctx.fillStyle = color;
      ctx.fillRect(x - 0.5, 0, 1.5, height);
      ctx.beginPath();
      ctx.moveTo(x - 5, 0);
      ctx.lineTo(x + 5, 0);
      ctx.lineTo(x, 7);
      ctx.fill();
      if (label) {
        ctx.font = "600 10px ui-monospace, monospace";
        ctx.fillText(label, x + 4, height - 4);
      }
    };
    marker(deck.cuePointSec, "#f5c542");
    deck.hotCues.forEach((cue, i) => cue && marker(cue.positionSec, cue.color ?? accent, String.fromCharCode(65 + i)));

    // Playhead
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    ctx.fillRect(width / 2 - 1, 0, 2, height);
    ctx.shadowBlur = 0;
  });

  return <canvas ref={canvasRef} className={className} aria-label={`Deck ${deckId} waveform`} role="img" />;
};

/** Whole-track overview with playhead, cues and click-to-seek */
export const OverviewWaveform = ({
  deckId,
  onSeek,
  className,
}: {
  deckId: DeckId;
  onSeek?: (positionSec: number) => void;
  className?: string;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Re-render the static layer only when the waveform/track changes
  const staticKey = useRef<string>("");
  const staticLayer = useRef<HTMLCanvasElement | null>(null);

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height, dpr } = fitCanvas(canvas);
    const { decks, tracks } = useDjStore.getState();
    const deck = decks[deckId];
    const url = deck.trackUrl;
    const analysis = url ? tracks[url]?.analysis : undefined;
    const duration = analysis?.durationSec ?? getTrackMeta(url)?.durationSec;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!url || !analysis || !duration) return;

    const key = `${url}:${canvas.width}x${canvas.height}`;
    if (staticKey.current !== key) {
      const layer = staticLayer.current ?? document.createElement("canvas");
      layer.width = canvas.width;
      layer.height = canvas.height;
      const lctx = layer.getContext("2d")!;
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const wf = analysis.waveform;
      const total = wf.low.length;
      const mid = height / 2;
      for (let x = 0; x < width; x++) {
        // Max over the buckets this pixel covers keeps transients visible
        const b0 = Math.floor((x / width) * total);
        const b1 = Math.max(b0 + 1, Math.floor(((x + 1) / width) * total));
        let best = b0;
        for (let b = b0; b < b1 && b < total; b++) if (wf.peak[b] > wf.peak[best]) best = b;
        drawColumn(lctx, wf, Math.min(best, total - 1), x, 1, mid, mid - 1);
      }
      staticLayer.current = layer;
      staticKey.current = key;
    }
    ctx.drawImage(staticLayer.current!, 0, 0);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const position = getDeckDisplayPosition(deckId);
    const px = (position / duration) * width;
    // Dim what has already played
    ctx.fillStyle = "rgba(10, 12, 16, 0.45)";
    ctx.fillRect(0, 0, px, height);
    if (deck.loop) {
      ctx.fillStyle = "rgba(90, 211, 140, 0.35)";
      ctx.fillRect(
        (deck.loop.startSec / duration) * width,
        0,
        Math.max(2, ((deck.loop.endSec - deck.loop.startSec) / duration) * width),
        height
      );
    }
    deck.hotCues.forEach((cue) => {
      if (!cue) return;
      ctx.fillStyle = cue.color ?? deckAccent(deckId);
      ctx.fillRect((cue.positionSec / duration) * width - 1, 0, 2, height);
    });
    ctx.fillStyle = "#f5c542";
    ctx.fillRect((deck.cuePointSec / duration) * width - 1, 0, 2, 5);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(px - 1, 0, 2, height);
  });

  const handlePointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onSeek) return;
    const { decks, tracks } = useDjStore.getState();
    const url = decks[deckId].trackUrl;
    const duration = (url && tracks[url]?.analysis?.durationSec) || getTrackMeta(url)?.durationSec;
    if (!duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration);
  };

  return (
    <canvas
      ref={canvasRef}
      className={className}
      onPointerDown={handlePointer}
      role="img"
      aria-label={`Deck ${deckId} track overview. Click to seek.`}
      style={{ cursor: onSeek ? "pointer" : undefined }}
    />
  );
};
