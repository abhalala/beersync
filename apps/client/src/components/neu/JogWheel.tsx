"use client";

import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { cx } from "./cx";
import { angleDelta, jogDegreesToSeconds, pointerAngle } from "./math";

export interface JogWheelHandle {
  /** Rotate the playhead marker. Direct style mutation — no React render. */
  setAngle: (deg: number) => void;
}

export interface JogWheelProps {
  ref?: Ref<JogWheelHandle>;
  /** Initial marker angle (use `ref.setAngle` for per-frame updates). */
  angleDeg?: number;
  /** Diameter in px; the wheel shrinks to fit narrow containers. */
  size?: number;
  color?: string;
  /** Phase nudge from dragging the ring (or the top when not in scrub mode). */
  onNudge?: (deltaSec: number) => void;
  /** Vinyl-mode scrub from dragging the platter top. */
  onScrub?: (deltaSec: number) => void;
  /** When true, touching the platter top scrubs instead of nudging. */
  scrubMode?: boolean;
  /** Platter top touched / released (vinyl mode: hold-to-stop). */
  onTouchChange?: (touching: boolean) => void;
  /** Seconds of offset per full ring turn (default 0.25 s). */
  nudgeSecondsPerTurn?: number;
  /** Seconds per full turn when scrubbing (default 1.8 s ≈ 33⅓ rpm). */
  scrubSecondsPerTurn?: number;
  /** Seconds per arrow-key press (Shift = ×0.2). */
  keyNudgeSec?: number;
  label?: string;
  disabled?: boolean;
  /** Centre slot content (BPM readout …); does not intercept the pointer. */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Fraction of the radius that counts as the platter top (inside = top, outside = ring). */
const TOP_RADIUS = 0.74;
/** Ignore angle changes this close to the centre — atan2 is unstable there. */
const DEAD_RADIUS = 0.12;
const BATCH_MS = 60;

export function JogWheel({
  ref,
  angleDeg = 0,
  size = 240,
  color = "var(--deck-a)",
  onNudge,
  onScrub,
  scrubMode = false,
  onTouchChange,
  nudgeSecondsPerTurn = 0.25,
  scrubSecondsPerTurn = 1.8,
  keyNudgeSec = 0.01,
  label = "Jog wheel",
  disabled = false,
  children,
  className,
  style,
}: JogWheelProps) {
  const descId = useId();
  const markerRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: number;
    cx: number;
    cy: number;
    radius: number;
    lastAngle: number | null;
    mode: "nudge" | "scrub";
    top: boolean;
  } | null>(null);
  const pending = useRef<{ deg: number; mode: "nudge" | "scrub"; timer: ReturnType<typeof setTimeout> | null }>({
    deg: 0,
    mode: "nudge",
    timer: null,
  });
  const gripAngle = useRef(0);

  // Latest callbacks for the batch timer.
  const cbRef = useRef({ onNudge, onScrub, onTouchChange, nudgeSecondsPerTurn, scrubSecondsPerTurn });
  useEffect(() => {
    cbRef.current = { onNudge, onScrub, onTouchChange, nudgeSecondsPerTurn, scrubSecondsPerTurn };
  });

  useImperativeHandle(
    ref,
    () => ({
      setAngle: (deg: number) => {
        const el = markerRef.current;
        if (el) el.style.transform = `rotate(${deg}deg)`;
      },
    }),
    []
  );

  const flush = () => {
    const p = pending.current;
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    if (p.deg === 0) return;
    const cb = cbRef.current;
    if (p.mode === "scrub") cb.onScrub?.(jogDegreesToSeconds(p.deg, cb.scrubSecondsPerTurn));
    else cb.onNudge?.(jogDegreesToSeconds(p.deg, cb.nudgeSecondsPerTurn));
    p.deg = 0;
  };

  useEffect(
    () => () => {
      if (pending.current.timer) clearTimeout(pending.current.timer);
    },
    []
  );

  const accumulate = (deg: number, mode: "nudge" | "scrub") => {
    const p = pending.current;
    if (p.mode !== mode) flush();
    p.mode = mode;
    p.deg += deg;
    if (!p.timer) p.timer = setTimeout(flush, BATCH_MS);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || gesture.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    const rect = e.currentTarget.getBoundingClientRect();
    const radius = rect.width / 2;
    const cx0 = rect.left + radius;
    const cy0 = rect.top + rect.height / 2;
    const dx = e.clientX - cx0;
    const dy = e.clientY - cy0;
    const r = Math.hypot(dx, dy);
    if (r > radius * 1.02) return; // corner of the bounding box, outside the disc
    e.currentTarget.setPointerCapture(e.pointerId);
    const top = r < radius * TOP_RADIUS;
    const mode = top && scrubMode && onScrub ? "scrub" : "nudge";
    gesture.current = {
      id: e.pointerId,
      cx: cx0,
      cy: cy0,
      radius,
      lastAngle: r > radius * DEAD_RADIUS ? pointerAngle(dx, dy) : null,
      mode,
      top,
    };
    e.currentTarget.dataset.touching = top ? "top" : "ring";
    if (top) cbRef.current.onTouchChange?.(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.cx;
    const dy = e.clientY - g.cy;
    if (Math.hypot(dx, dy) < g.radius * DEAD_RADIUS) {
      g.lastAngle = null;
      return;
    }
    const a = pointerAngle(dx, dy);
    if (g.lastAngle !== null) {
      const d = angleDelta(g.lastAngle, a);
      if (d !== 0) {
        accumulate(d, g.mode);
        gripAngle.current = (gripAngle.current + d) % 360;
        if (gripRef.current) gripRef.current.style.transform = `rotate(${gripAngle.current}deg)`;
      }
    }
    g.lastAngle = a;
  };

  const finish = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    delete e.currentTarget.dataset.touching;
    flush();
    if (g.top) cbRef.current.onTouchChange?.(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const amount = e.shiftKey ? keyNudgeSec * 0.2 : keyNudgeSec;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onNudge?.(amount);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onNudge?.(-amount);
    }
  };

  return (
    <div
      className={cx("neu-jog neu-focusable", className)}
      style={{ "--jog-size": `${size}px`, "--accent": color, ...style } as CSSProperties}
      role="group"
      aria-roledescription="jog wheel"
      aria-label={label}
      aria-describedby={descId}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      data-scrub={scrubMode || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={gripRef} className="neu-jog-grip" aria-hidden="true" />
      <div className="neu-jog-top" aria-hidden="true">
        <div ref={markerRef} className="neu-jog-marker" style={{ transform: `rotate(${angleDeg}deg)` }}>
          <span />
        </div>
      </div>
      <div className="neu-jog-center">{children}</div>
      <span id={descId} hidden>
        Drag the ring to nudge the beat. Arrow keys nudge; hold Shift for finer steps.
      </span>
    </div>
  );
}
