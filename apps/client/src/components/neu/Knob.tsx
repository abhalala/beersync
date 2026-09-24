"use client";

import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { cx, DOUBLE_TAP_MS, TAP_SLOP_PX } from "./cx";
import {
  applyDrag,
  clamp,
  describeArc,
  dragDeltaToValue,
  FINE_FACTOR,
  keyboardStep,
  KNOB_SWEEP_DEG,
  quantize,
  valueToAngle,
} from "./math";
import { useGuardedValue, useLatest } from "./useGuardedValue";

export interface KnobProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Value restored on double-click / double-tap. Also the detent for `bipolar`. */
  defaultValue?: number;
  /** Arc drawn from the centre (EQ / filter) with a snapping centre detent. */
  bipolar?: boolean;
  /** Diameter in px (the hit area never drops below 40px). */
  size?: number;
  /** Accent CSS colour for the arc + glow. */
  color?: string;
  label?: string;
  /** Accessible name when there is no visible label. */
  "aria-label"?: string;
  format?: (value: number) => string;
  disabled?: boolean;
  /** Pixels of vertical travel for a full sweep at normal speed. */
  dragRange?: number;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
  className?: string;
  style?: CSSProperties;
}

const defaultFormat = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

export function Knob({
  value,
  min = 0,
  max = 1,
  step,
  defaultValue,
  bipolar = false,
  size = 56,
  color = "var(--deck-a)",
  label,
  "aria-label": ariaLabel,
  format = defaultFormat,
  disabled = false,
  dragRange = 200,
  onChange,
  onCommit,
  className,
  style,
}: KnobProps) {
  const center = defaultValue ?? (bipolar ? (min + max) / 2 : min);
  const detent = bipolar ? center : undefined;
  const q = (raw: number) => quantize(raw, { min, max, step, detent });

  const guard = useGuardedValue({ value, min, max, onChange, onCommit });
  const display = guard.display;
  const displayRef = useLatest(display);

  const labelId = useId();
  const dialRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; lastY: number; startY: number; raw: number; moved: boolean } | null>(null);
  const lastTapRef = useRef(0);
  const wheelRef = useRef<{ raw: number; t: number } | null>(null);

  // React's onWheel is passive, so preventDefault needs a native listener.
  const wheelCfg = useLatest({ min, max, disabled, set: guard.set, q });
  useEffect(() => {
    const el = dialRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const cfg = wheelCfg.current;
      if (cfg.disabled) return;
      e.preventDefault();
      const now = performance.now();
      const prev = wheelRef.current;
      const base = prev && now - prev.t < 400 ? prev.raw : displayRef.current;
      const px = -(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY);
      const raw = clamp(base + dragDeltaToValue(px, cfg.min, cfg.max, 800, e.shiftKey), cfg.min, cfg.max);
      wheelRef.current = { raw, t: now };
      cfg.set(cfg.q(raw), false);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [wheelCfg, displayRef]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || gesture.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { id: e.pointerId, lastY: e.clientY, startY: e.clientY, raw: display, moved: false };
    guard.begin();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dy = e.clientY - g.lastY;
    g.lastY = e.clientY;
    g.raw = applyDrag(g.raw, -dy, { min, max, pixelsForFullRange: dragRange, fine: e.shiftKey });
    if (!g.moved && Math.abs(e.clientY - g.startY) > TAP_SLOP_PX) g.moved = true;
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
      guard.set(q(center));
    } else {
      lastTapRef.current = now;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const base = keyboardStep(min, max, step);
    const inc = e.shiftKey && !step ? base * FINE_FACTOR : base;
    let next: number | null = null;
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
        next = center;
        break;
    }
    if (next === null) return;
    e.preventDefault();
    // Keyboard steps shouldn't get trapped by the detent: only snap exact hits.
    guard.set(quantize(next, { min, max, step }));
  };

  const angle = valueToAngle(display, min, max);
  const startAngle = bipolar ? valueToAngle(center, min, max) : -KNOB_SWEEP_DEG / 2;
  const valueText = format(display);
  const hit = Math.max(size, 40);

  return (
    <div
      className={cx("neu-knob", className)}
      style={{ "--knob-size": `${size}px`, "--knob-hit": `${hit}px`, "--accent": color, ...style } as CSSProperties}
      data-disabled={disabled || undefined}
    >
      <div
        ref={dialRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={label && !ariaLabel ? labelId : undefined}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={display}
        aria-valuetext={valueText}
        aria-disabled={disabled || undefined}
        aria-orientation="vertical"
        className="neu-knob-dial neu-focusable"
        data-active={guard.dragging || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg className="neu-knob-svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          <path className="neu-knob-track" d={describeArc(50, 50, 45, -KNOB_SWEEP_DEG / 2, KNOB_SWEEP_DEG / 2)} />
          {bipolar && (
            <line
              className="neu-knob-detent"
              x1="50"
              y1="0.5"
              x2="50"
              y2="6"
              transform={`rotate(${valueToAngle(center, min, max)} 50 50)`}
            />
          )}
          <path className="neu-knob-arc" d={describeArc(50, 50, 45, startAngle, angle)} />
        </svg>
        <div className="neu-knob-cap">
          <div className="neu-knob-rot" style={{ transform: `rotate(${angle}deg)` }}>
            <span className="neu-knob-pointer" />
          </div>
        </div>
        <span className="neu-readout" aria-hidden="true">
          {valueText}
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
