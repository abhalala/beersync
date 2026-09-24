"use client";

import { useId, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { cx, DOUBLE_TAP_MS, TAP_SLOP_PX } from "./cx";
import { clamp, faderDragToValueDelta, faderPosition, FINE_FACTOR, keyboardStep, quantize } from "./math";
import { useGuardedValue } from "./useGuardedValue";

export interface FaderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Restored on double-click / double-tap / Delete. Defaults to the detent or `min`. */
  defaultValue?: number;
  orientation?: "vertical" | "horizontal";
  /**
   * Flip the direction: vertical → top is `min` (CDJ pitch fader: push away =
   * slower); horizontal → right is `min`.
   */
  reverse?: boolean;
  /** Snap zone at the centre (`true` = midpoint) or at a given value. */
  centerDetent?: boolean | number;
  /** Tick marks: a count spread evenly across the range, or explicit values. */
  ticks?: number | number[];
  /** Track length in px, or any CSS length (e.g. "100%") for fluid faders. */
  length?: number | string;
  color?: string;
  label?: string;
  "aria-label"?: string;
  format?: (value: number) => string;
  disabled?: boolean;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
  className?: string;
  style?: CSSProperties;
}

const defaultFormat = (v: number) => v.toFixed(2);

export function Fader({
  value,
  min = 0,
  max = 1,
  step,
  defaultValue,
  orientation = "vertical",
  reverse = false,
  centerDetent,
  ticks,
  length,
  color = "var(--deck-a)",
  label,
  "aria-label": ariaLabel,
  format = defaultFormat,
  disabled = false,
  onChange,
  onCommit,
  className,
  style,
}: FaderProps) {
  const vertical = orientation === "vertical";
  const detent =
    centerDetent === undefined || centerDetent === false
      ? undefined
      : centerDetent === true
        ? (min + max) / 2
        : centerDetent;
  const resetTo = defaultValue ?? detent ?? min;
  const q = (raw: number) => quantize(raw, { min, max, step, detent });

  const guard = useGuardedValue({ value, min, max, onChange, onCommit });
  const display = guard.display;

  const labelId = useId();
  const railRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: number;
    last: number;
    start: number;
    raw: number;
    trackPx: number;
    moved: boolean;
  } | null>(null);
  const lastTapRef = useRef(0);

  const axis = (e: PointerEvent) => (vertical ? e.clientY : e.clientX);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || gesture.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = railRef.current?.getBoundingClientRect();
    const trackPx = Math.max(40, rect ? (vertical ? rect.height : rect.width) : 160);
    // Relative drag: grabbing the track anywhere never jumps the value.
    gesture.current = { id: e.pointerId, last: axis(e), start: axis(e), raw: display, trackPx, moved: false };
    guard.begin();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const pos = axis(e);
    const delta = pos - g.last;
    g.last = pos;
    g.raw = clamp(
      g.raw + faderDragToValueDelta(delta, g.trackPx, min, max, orientation, reverse, e.shiftKey),
      min,
      max
    );
    if (!g.moved && Math.abs(pos - g.start) > TAP_SLOP_PX) g.moved = true;
    if (g.moved) guard.update(q(g.raw));
  };

  const finish = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (g.moved) {
      guard.end();
      lastTapRef.current = 0;
      return;
    }
    guard.cancel();
    if (e.type !== "pointerup") return;
    const now = performance.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      guard.set(q(resetTo));
    } else {
      lastTapRef.current = now;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const base = keyboardStep(min, max, step);
    const inc = e.shiftKey && !step ? base * FINE_FACTOR : base;
    let next: number | null = null;
    // ARIA slider semantics: Up/Right always increase, even when `reverse`.
    switch (e.key) {
      case "ArrowUp":
      case "ArrowRight":
        next = display + inc;
        break;
      case "ArrowDown":
      case "ArrowLeft":
        next = display - inc;
        break;
      case "PageUp":
        next = display + base * 10;
        break;
      case "PageDown":
        next = display - base * 10;
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      case "Delete":
      case "Backspace":
        next = resetTo;
        break;
    }
    if (next === null) return;
    e.preventDefault();
    guard.set(quantize(next, { min, max, step }));
  };

  const pos = faderPosition(display, min, max, orientation, reverse);
  const tickValues =
    ticks === undefined
      ? []
      : Array.isArray(ticks)
        ? ticks
        : Array.from({ length: Math.max(2, ticks) }, (_, i) => min + ((max - min) * i) / (Math.max(2, ticks) - 1));
  const lengthCss = length === undefined ? undefined : typeof length === "number" ? `${length}px` : length;

  return (
    <div
      className={cx("neu-fader", className)}
      data-orientation={orientation}
      data-disabled={disabled || undefined}
      style={{ "--accent": color, ...(lengthCss ? { "--fader-length": lengthCss } : null), ...style } as CSSProperties}
    >
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={label && !ariaLabel ? labelId : undefined}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={display}
        aria-valuetext={format(display)}
        aria-orientation={orientation}
        aria-disabled={disabled || undefined}
        className="neu-fader-body neu-focusable"
        data-active={guard.dragging || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="neu-fader-groove" aria-hidden="true" />
        <div ref={railRef} className="neu-fader-rail" aria-hidden="true">
          {tickValues.map((t, i) => (
            <span
              key={i}
              className="neu-fader-tick"
              data-major={detent !== undefined && Math.abs(t - detent) < 1e-9 ? "" : undefined}
              style={{ "--pos": faderPosition(t, min, max, orientation, reverse) } as CSSProperties}
            />
          ))}
          {detent !== undefined && tickValues.length === 0 && (
            <span
              className="neu-fader-tick"
              data-major=""
              style={{ "--pos": faderPosition(detent, min, max, orientation, reverse) } as CSSProperties}
            />
          )}
          <div className="neu-fader-carriage" style={{ "--pos": pos } as CSSProperties}>
            <div className="neu-fader-cap">
              <span className="neu-fader-cap-line" />
            </div>
          </div>
        </div>
        <span className="neu-readout" aria-hidden="true">
          {format(display)}
        </span>
      </div>
      {label && (
        <span id={labelId} className="neu-label">
          {label}
        </span>
      )}
    </div>
  );
}
