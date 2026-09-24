"use client";
import type { Waveform } from "@/lib/dj/analysis";
import { getBeatGrid, getDeckDisplayPosition, useDjStore } from "@/store/dj";
import type { DeckId } from "@beatsync/shared";
import { beatLengthSec } from "@beatsync/shared";
import { useRef } from "react";
import { fitCanvas, useAnimationFrame } from "./useAnimationFrame";

// Same 3-band palette as the horizontal ScrollingWaveform, rotated 90°
const LOW_COLOR = "rgba(52, 110, 255, 0.95)";
const MID_COLOR = "rgba(243, 165, 61, 0.9)";
const HIGH_COLOR = "rgba(240, 244, 250, 0.9)";

const deckAccent = (deckId: DeckId) => (deckId === "A" ? "#3ccbe2" : "#f3a53d");

/**
 * Time → canvas-y mapping shared by drawing and pointer math. The playhead
 * sits fixed at `playheadFrac` of the canvas height; time above it is in the
 * past (scrolled up and out), time below is upcoming — Serato-style vertical
 * scroll (top → bottom).
 */
export const timeToY = (
  t: number,
  positionSec: number,
  height: number,
  pxPerSec: number,
  playheadFrac = 0.18
): number => (t - positionSec) * pxPerSec + height * playheadFrac;

const drawRow = (
  ctx: CanvasRenderingContext2D,
  wf: Waveform,
  bucket: number,
  y: number,
  h: number,
  mid: number,
  half: number
) => {
  const low = wf.low[bucket] / 255;
  const m = wf.mid[bucket] / 255;
  const high = wf.high[bucket] / 255;
  ctx.fillStyle = LOW_COLOR;
  ctx.fillRect(mid - low * half, y, low * half * 2, h);
  ctx.fillStyle = MID_COLOR;
  ctx.fillRect(mid - m * half * 0.8, y, m * half * 1.6, h);
  ctx.fillStyle = HIGH_COLOR;
  ctx.fillRect(mid - high * half * 0.55, y, high * half * 1.1, h);
};

interface VerticalWaveformProps {
  deckId: DeckId;
  /** Seconds of audio visible across the height */
  windowSec?: number;
  /** Fraction of the height the fixed playhead line sits at (0 = top) */
  playheadFrac?: number;
  className?: string;
}

/** Zoomed waveform that scrolls top→bottom with the playhead fixed horizontally (Serato-style) */
export const VerticalWaveform = ({ deckId, windowSec = 10, playheadFrac = 0.18, className }: VerticalWaveformProps) => {
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
    const mid = width / 2;
    const accent = deckAccent(deckId);
    const pxPerSec = height / windowSec;
    const playheadY = height * playheadFrac;

    if (!url || !wf) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(0, playheadY - 0.5, width, 1);
      return;
    }

    const position = getDeckDisplayPosition(deckId);
    const half = width / 2 - 4;
    const startSec = position - playheadFrac * windowSec;

    // Loop region
    if (deck.loop) {
      const y0 = timeToY(deck.loop.startSec, position, height, pxPerSec, playheadFrac);
      const y1 = timeToY(deck.loop.endSec, position, height, pxPerSec, playheadFrac);
      ctx.fillStyle = "rgba(90, 211, 140, 0.16)";
      ctx.fillRect(0, y0, width, y1 - y0);
    }

    // Waveform rows (2 CSS px tall)
    const rowHeight = 2;
    for (let y = 0; y < height; y += rowHeight) {
      const t = startSec + y / pxPerSec;
      if (t < 0) continue;
      const bucket = Math.floor(t * wf.bucketsPerSecond);
      if (bucket >= wf.low.length) break;
      drawRow(ctx, wf, bucket, y, rowHeight - 0.5, mid, half);
    }

    // Beat grid: every beat faint, every bar (4 beats) bright
    const grid = getBeatGrid(url, tracks);
    if (grid) {
      const beatLen = beatLengthSec(grid.bpm);
      const first = Math.ceil((startSec - grid.firstBeatSec) / beatLen);
      const last = Math.floor((startSec + windowSec - grid.firstBeatSec) / beatLen);
      for (let i = first; i <= last; i++) {
        const y = Math.round(timeToY(grid.firstBeatSec + i * beatLen, position, height, pxPerSec, playheadFrac)) + 0.5;
        const isBar = ((i % 4) + 4) % 4 === 0;
        ctx.fillStyle = isBar ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.16)";
        ctx.fillRect(0, y, isBar ? width : 8, 1);
        if (!isBar) ctx.fillRect(width - 8, y, 8, 1);
      }
    }

    // Memory cue + hot cues
    const marker = (sec: number, color: string, label?: string) => {
      const y = timeToY(sec, position, height, pxPerSec, playheadFrac);
      if (y < -10 || y > height + 10) return;
      ctx.fillStyle = color;
      ctx.fillRect(0, y - 0.5, width, 1.5);
      ctx.beginPath();
      ctx.moveTo(0, y - 5);
      ctx.lineTo(0, y + 5);
      ctx.lineTo(7, y);
      ctx.fill();
      if (label) {
        ctx.font = "600 10px ui-monospace, monospace";
        ctx.fillText(label, width - 12, y - 4);
      }
    };
    marker(deck.cuePointSec, "#f5c542");
    deck.hotCues.forEach((cue, i) => cue && marker(cue.positionSec, cue.color ?? accent, String.fromCharCode(65 + i)));

    // Playhead
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    ctx.fillRect(0, playheadY - 1, width, 2);
    ctx.shadowBlur = 0;
  });

  return <canvas ref={canvasRef} className={className} aria-label={`Deck ${deckId} vertical waveform`} role="img" />;
};
