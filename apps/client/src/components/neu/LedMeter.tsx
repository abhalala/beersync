"use client";

import { useImperativeHandle, useRef, type CSSProperties, type Ref } from "react";
import { cx } from "./cx";
import { clamp } from "./math";

export interface LedMeterHandle {
  /**
   * Drive the meter (0‥1). Pass `peak` to control the peak LED yourself;
   * otherwise the meter holds the highest recent level for `peakHoldMs`.
   * Mutates the DOM directly — safe to call every animation frame.
   */
  setLevel: (level: number, peak?: number) => void;
  reset: () => void;
}

export interface LedMeterProps {
  ref?: Ref<LedMeterHandle>;
  segments?: number;
  /** Segments from the top that are red / amber. */
  redSegments?: number;
  amberSegments?: number;
  /** Total height (any CSS length). */
  height?: number | string;
  width?: number;
  peakHoldMs?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** Vertical segmented VU meter; decorative (aria-hidden) — audio level isn't useful to announce per frame. */
export function LedMeter({
  ref,
  segments = 15,
  redSegments = 2,
  amberSegments = 3,
  height = 160,
  width = 10,
  peakHoldMs = 900,
  label,
  className,
  style,
}: LedMeterProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const state = useRef<{ heldIdx: number; heldAt: number; shown: Int8Array | null }>({
    heldIdx: -1,
    heldAt: 0,
    shown: null,
  });

  useImperativeHandle(ref, () => {
    const paint = (lit: number, peakIdx: number) => {
      const list = listRef.current;
      if (!list) return;
      const s = state.current;
      const n = list.children.length;
      if (!s.shown || s.shown.length !== n) s.shown = new Int8Array(n).fill(-1);
      // children are rendered top → bottom; index 0 = top segment
      for (let i = 0; i < n; i++) {
        const segIdx = n - 1 - i; // 0 = bottom
        const next = segIdx < lit ? 1 : segIdx === peakIdx ? 2 : 0;
        if (s.shown[i] !== next) {
          s.shown[i] = next;
          (list.children[i] as HTMLElement).dataset.on = next === 0 ? "0" : next === 1 ? "1" : "peak";
        }
      }
    };
    return {
      setLevel: (level: number, peak?: number) => {
        const s = state.current;
        const n = listRef.current?.children.length ?? segments;
        const lit = Math.round(clamp(level, 0, 1) * n);
        let peakIdx: number;
        if (peak !== undefined) {
          peakIdx = Math.round(clamp(peak, 0, 1) * n) - 1;
        } else {
          const now = performance.now();
          if (lit - 1 >= s.heldIdx || now - s.heldAt > peakHoldMs) {
            s.heldIdx = lit - 1;
            s.heldAt = now;
          }
          peakIdx = s.heldIdx;
        }
        paint(lit, peakIdx);
      },
      reset: () => {
        const s = state.current;
        s.heldIdx = -1;
        s.heldAt = 0;
        paint(0, -1);
      },
    };
  }, [segments, peakHoldMs]);

  return (
    <div
      className={cx("neu-meter", className)}
      style={
        {
          "--meter-h": typeof height === "number" ? `${height}px` : height,
          "--meter-w": `${width}px`,
          ...style,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <div ref={listRef} className="neu-meter-list">
        {Array.from({ length: segments }, (_, i) => {
          const fromTop = i;
          const zone = fromTop < redSegments ? "crit" : fromTop < redSegments + amberSegments ? "warn" : "ok";
          return <span key={i} className="neu-meter-seg" data-zone={zone} data-on="0" />;
        })}
      </div>
      {label && <span className="neu-label">{label}</span>}
    </div>
  );
}
