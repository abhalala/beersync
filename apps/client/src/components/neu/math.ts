// Pure helpers for the neumorphic console controls. Everything here is
// framework-free so it can be unit tested and reused by other surfaces.

/** Default sweep of a rotary knob, in degrees (-135° … +135°, 0° = 12 o'clock). */
export const KNOB_SWEEP_DEG = 270;

/** Fine-mode multiplier applied while Shift is held. */
export const FINE_FACTOR = 0.1;

/** Centre detent capture zone as a fraction of the full range (±3 %). */
export const DETENT_THRESHOLD = 0.03;

export function clamp(value: number, min: number, max: number): number {
  if (min > max) [min, max] = [max, min];
  return value < min ? min : value > max ? max : value;
}

/** Number of decimal places a step implies (handles `1e-7` notation). */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = step.toString().toLowerCase();
  const exp = text.indexOf("e-");
  if (exp !== -1) {
    const mantissa = text.slice(0, exp);
    const dot = mantissa.indexOf(".");
    const mantissaDecimals = dot === -1 ? 0 : mantissa.length - dot - 1;
    return mantissaDecimals + Number(text.slice(exp + 2));
  }
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * Round `value` to the nearest multiple of `step` counted from `min`, then
 * strip binary float noise (0.1 + 0.2 → 0.3, not 0.30000000000000004) so
 * values compare equal to what the server echoes back.
 */
export function roundToStep(value: number, step: number | undefined, min = 0): number {
  if (!step || step <= 0 || !Number.isFinite(step)) return value;
  const n = Math.round((value - min) / step);
  const decimals = Math.min(15, Math.max(stepDecimals(step), stepDecimals(Math.abs(min) || 0)));
  return Number((min + n * step).toFixed(decimals));
}

/**
 * Snap `value` to `center` when within `threshold` × range of it. Used for
 * bipolar knobs (EQ, filter) and pitch / crossfaders.
 */
export function snapToDetent(
  value: number,
  center: number,
  min: number,
  max: number,
  threshold = DETENT_THRESHOLD
): number {
  const range = Math.abs(max - min);
  if (range === 0) return value;
  return Math.abs(value - center) <= threshold * range ? center : value;
}

export interface QuantizeOptions {
  min: number;
  max: number;
  step?: number;
  /** When set, values within ±threshold of this snap to it. */
  detent?: number;
  detentThreshold?: number;
}

/** Raw (unrounded) drag value → value to display / emit. */
export function quantize(raw: number, opts: QuantizeOptions): number {
  const { min, max, step, detent, detentThreshold } = opts;
  let v = clamp(raw, min, max);
  if (detent !== undefined) v = snapToDetent(v, detent, min, max, detentThreshold);
  v = roundToStep(v, step, min);
  return clamp(v, min, max);
}

/**
 * Convert a pointer delta in pixels to a value delta. `pixelsForFullRange` is
 * how far the pointer must travel to sweep the whole range at normal speed;
 * fine mode (Shift) divides the speed by 10.
 */
export function dragDeltaToValue(
  deltaPx: number,
  min: number,
  max: number,
  pixelsForFullRange: number,
  fine = false
): number {
  if (pixelsForFullRange <= 0) return 0;
  const perPx = (max - min) / pixelsForFullRange;
  return deltaPx * perPx * (fine ? FINE_FACTOR : 1);
}

/**
 * Accumulate a drag delta onto the running raw value. The raw value is kept
 * unrounded (but clamped so overshooting past an end doesn't need to be
 * "unwound") — that's what lets slow drags cross step boundaries and lets the
 * user drag *out* of a detent rather than being stuck in it.
 */
export function applyDrag(
  raw: number,
  deltaPx: number,
  opts: { min: number; max: number; pixelsForFullRange: number; fine?: boolean }
): number {
  const next = raw + dragDeltaToValue(deltaPx, opts.min, opts.max, opts.pixelsForFullRange, opts.fine);
  return clamp(next, opts.min, opts.max);
}

/** 0‥1 fraction of the range. */
export function valueToFraction(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

export function fractionToValue(fraction: number, min: number, max: number): number {
  return min + clamp(fraction, 0, 1) * (max - min);
}

/** Value → knob angle in degrees, 0° = 12 o'clock, clockwise positive. */
export function valueToAngle(value: number, min: number, max: number, sweep = KNOB_SWEEP_DEG): number {
  return -sweep / 2 + valueToFraction(value, min, max) * sweep;
}

export function angleToValue(angle: number, min: number, max: number, sweep = KNOB_SWEEP_DEG): number {
  return fractionToValue((angle + sweep / 2) / sweep, min, max);
}

/**
 * Position of a fader cap along its track as a 0‥1 fraction measured from the
 * visual start of the track (top for vertical, left for horizontal).
 *
 * - vertical: max is at the top (fraction 0) — unless `reverse`, where the top
 *   is the minimum (CDJ pitch fader: pushing away = slower).
 * - horizontal: min is at the left — unless `reverse`.
 */
export function faderPosition(
  value: number,
  min: number,
  max: number,
  orientation: "vertical" | "horizontal",
  reverse = false
): number {
  const f = valueToFraction(value, min, max);
  const startIsMax = orientation === "vertical" ? !reverse : reverse;
  return startIsMax ? 1 - f : f;
}

/**
 * Pointer movement along the fader axis (pixels, positive = down/right) →
 * value delta, 1:1 with the cap so the cap stays under the finger.
 */
export function faderDragToValueDelta(
  deltaPx: number,
  trackPx: number,
  min: number,
  max: number,
  orientation: "vertical" | "horizontal",
  reverse = false,
  fine = false
): number {
  const startIsMax = orientation === "vertical" ? !reverse : reverse;
  const signed = startIsMax ? -deltaPx : deltaPx;
  return dragDeltaToValue(signed, min, max, trackPx, fine);
}

/** Shortest signed angular difference `to - from`, in (-180, 180]. */
export function angleDelta(fromDeg: number, toDeg: number): number {
  let d = (toDeg - fromDeg) % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

/** Pointer position relative to a centre → angle in degrees, 0° = 12 o'clock, clockwise. */
export function pointerAngle(dx: number, dy: number): number {
  return (Math.atan2(dy, dx) * 180) / Math.PI + 90;
}

/** Jog rotation (degrees, clockwise positive) → playback nudge in seconds. */
export function jogDegreesToSeconds(deltaDeg: number, secondsPerTurn: number): number {
  return (deltaDeg / 360) * secondsPerTurn;
}

/** Point on a circle for an angle where 0° = 12 o'clock, clockwise. */
export function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG path `d` for an arc between two angles (order-independent). */
export function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  let a = startDeg;
  let b = endDeg;
  if (b < a) [a, b] = [b, a];
  if (b - a < 0.01) return "";
  const start = polarToCartesian(cx, cy, r, a);
  const end = polarToCartesian(cx, cy, r, b);
  const largeArc = b - a > 180 ? 1 : 0;
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

/** Keyboard increment for a control: explicit step, or 1 % of the range. */
export function keyboardStep(min: number, max: number, step?: number): number {
  return step && step > 0 ? step : Math.abs(max - min) / 100;
}

/** Tolerance used to decide whether a server echo matches what we sent. */
export function approxEqual(a: number, b: number, min: number, max: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-9, Math.abs(max - min) * 1e-6);
}
