"use client";

import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { cx, LONG_PRESS_MS, TAP_SLOP_PX } from "./cx";

export type Pad = { color?: string; label?: string } | null;

export interface PadGridProps {
  /** Up to 8 pads (4 × 2); missing entries render empty. */
  pads: ReadonlyArray<Pad>;
  /** Hot-cue press: jump to a set cue, or set a new cue on an empty pad. */
  onPress: (index: number) => void;
  /** Delete a cue: Shift+click, Delete/Backspace, or long-press ≥ 500 ms on touch. */
  onClear?: (index: number) => void;
  /** Default glow colour for set pads without their own colour. */
  color?: string;
  /** Prefix for accessible names ("Hot cue 1"). */
  name?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

const PAD_COUNT = 8;

/**
 * Trigger timing: mouse / pen fire `onPress` on pointer-down (cue juggling
 * needs zero latency). Touch fires on release instead, so a long-press can
 * clear a cue *without* first jumping the whole room's playhead to it.
 */
export function PadGrid({
  pads,
  onPress,
  onClear,
  color = "var(--deck-a)",
  name = "Hot cue",
  disabled = false,
  className,
  style,
}: PadGridProps) {
  const touch = useRef<{
    id: number;
    index: number;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  useEffect(
    () => () => {
      if (touch.current) clearTimeout(touch.current.timer);
    },
    []
  );

  const cancelTouch = () => {
    if (touch.current) clearTimeout(touch.current.timer);
    touch.current = null;
  };

  const onPointerDown = (index: number, e: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType === "touch") {
      cancelTouch();
      const pad = pads[index] ?? null;
      const timer = setTimeout(() => {
        if (!touch.current || touch.current.index !== index) return;
        touch.current = null;
        if (pad && onClear) {
          navigator.vibrate?.(12);
          onClear(index);
        }
      }, LONG_PRESS_MS);
      touch.current = { id: e.pointerId, index, x: e.clientX, y: e.clientY, timer };
      return;
    }
    e.preventDefault(); // keep focus ring from flashing on mouse; focus manually
    e.currentTarget.focus({ preventScroll: true });
    if (e.shiftKey) onClear?.(index);
    else onPress(index);
  };

  const onPointerUp = (index: number, e: PointerEvent<HTMLButtonElement>) => {
    const t = touch.current;
    if (!t || t.id !== e.pointerId) return;
    cancelTouch();
    if (t.index === index) onPress(index);
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const t = touch.current;
    if (!t || t.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > TAP_SLOP_PX * 4) cancelTouch();
  };

  const onKeyDown = (index: number, e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === "Delete" || e.key === "Backspace" || (e.shiftKey && (e.key === "Enter" || e.key === " "))) {
      e.preventDefault();
      if (pads[index]) onClear?.(index);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!e.repeat) onPress(index);
    }
  };

  return (
    <div className={cx("neu-pads", className)} style={style} role="group" aria-label={`${name}s`}>
      {Array.from({ length: PAD_COUNT }, (_, i) => {
        const pad = pads[i] ?? null;
        const n = i + 1;
        const desc = pad ? `${name} ${n}${pad.label ? `, ${pad.label}` : ""}` : `${name} ${n}, empty — press to set`;
        return (
          <button
            key={i}
            type="button"
            className="neu-pad neu-focusable"
            data-set={pad ? "" : undefined}
            style={pad ? ({ "--pad": pad.color ?? color } as CSSProperties) : undefined}
            aria-label={desc}
            aria-keyshortcuts={pad && onClear ? "Shift+Enter Delete" : undefined}
            disabled={disabled}
            onPointerDown={(e) => onPointerDown(i, e)}
            onPointerUp={(e) => onPointerUp(i, e)}
            onPointerMove={onPointerMove}
            onPointerCancel={cancelTouch}
            onPointerLeave={(e) => e.pointerType === "touch" && cancelTouch()}
            onKeyDown={(e) => onKeyDown(i, e)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="neu-pad-num" aria-hidden="true">
              {n}
            </span>
            {pad?.label && (
              <span className="neu-pad-label" aria-hidden="true">
                {pad.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
