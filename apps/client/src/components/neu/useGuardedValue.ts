"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { approxEqual } from "./math";

/**
 * Echo guard shared by every continuous control (Knob, Fader).
 *
 * The `value` prop comes from room state, which the server echoes back with
 * network delay. If we rendered it directly, a user's drag would be yanked
 * back to stale positions as late echoes arrive. So:
 *
 * 1. While dragging, the control renders its own `drag` value and ignores
 *    `value` completely.
 * 2. After release (or a keyboard / wheel / reset change) the control keeps
 *    showing the value it sent (`held`) until either the prop catches up to it
 *    (the echo arrived) or `holdMs` elapses (server dropped/clamped it — fall
 *    back to the truth). Intermediate echoes of mid-drag values therefore
 *    can't make the cap flicker back after release.
 * 3. `onChange` is coalesced to one call per animation frame; `onCommit` fires
 *    once on release with the final value.
 */
export interface GuardedValueOptions {
  value: number;
  min: number;
  max: number;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
  /** How long to trust our own last-sent value over a disagreeing prop. */
  holdMs?: number;
}

export interface GuardedValue {
  /** What the control should render. */
  display: number;
  dragging: boolean;
  /** Start a drag gesture from the current display value. */
  begin: () => void;
  /** Update during drag — renders immediately, emits onChange per frame. */
  update: (v: number) => void;
  /** Finish a drag gesture — flushes onChange and fires onCommit. */
  end: () => void;
  /** Abort a drag that never moved (a tap) — no onChange / onCommit. */
  cancel: () => void;
  /** Discrete change (keyboard, reset). `commit: false` debounces onCommit (wheel). */
  set: (v: number, commit?: boolean) => void;
}

const DEFAULT_HOLD_MS = 1500;
const WHEEL_COMMIT_MS = 250;

export function useGuardedValue({
  value,
  min,
  max,
  onChange,
  onCommit,
  holdMs = DEFAULT_HOLD_MS,
}: GuardedValueOptions): GuardedValue {
  const [drag, setDrag] = useState<number | null>(null);
  const [held, setHeld] = useState<{ v: number; id: number } | null>(null);

  // Echo arrived: stop holding. "Adjusting state while rendering" pattern —
  // conditional, so it settles in one extra render with no effect round-trip.
  if (held !== null && drag === null && approxEqual(value, held.v, min, max)) {
    setHeld(null);
  }

  const display = drag ?? held?.v ?? value;

  // Latest callbacks, read from rAF / timers without re-subscribing.
  const cbRef = useRef({ onChange, onCommit });
  useLayoutEffect(() => {
    cbRef.current = { onChange, onCommit };
  });

  const liveRef = useRef(value); // latest value during a gesture (not state-lagged)
  const lastEmittedRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdIdRef = useRef(0);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    },
    []
  );

  const emitChange = (v: number) => {
    if (lastEmittedRef.current !== null && lastEmittedRef.current === v) return;
    lastEmittedRef.current = v;
    cbRef.current.onChange?.(v);
  };

  const flushFrame = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    emitChange(liveRef.current);
  };

  const hold = (v: number) => {
    const id = ++holdIdRef.current;
    setHeld({ v, id });
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      setHeld((h) => (h && h.id === id ? null : h));
    }, holdMs);
  };

  const begin = () => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    liveRef.current = display;
    lastEmittedRef.current = display;
    setDrag(display);
  };

  const update = (v: number) => {
    liveRef.current = v;
    setDrag(v);
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        emitChange(liveRef.current);
      });
    }
  };

  const end = () => {
    flushFrame();
    const final = liveRef.current;
    setDrag(null);
    hold(final);
    lastEmittedRef.current = null;
    cbRef.current.onCommit?.(final);
  };

  const cancel = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastEmittedRef.current = null;
    setDrag(null);
  };

  const set = (v: number, commit = true) => {
    liveRef.current = v;
    hold(v);
    emitChange(v);
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    if (commit) {
      commitTimerRef.current = null;
      lastEmittedRef.current = null;
      cbRef.current.onCommit?.(v);
    } else {
      commitTimerRef.current = setTimeout(() => {
        commitTimerRef.current = null;
        lastEmittedRef.current = null;
        cbRef.current.onCommit?.(liveRef.current);
      }, WHEEL_COMMIT_MS);
    }
  };

  return { display, dragging: drag !== null, begin, update, end, cancel, set };
}

/** Keeps a ref pointing at the latest value, for native listeners. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
