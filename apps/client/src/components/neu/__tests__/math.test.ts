// Non-obvious control math: detent capture, fine mode, float-noise-free step
// rounding (values must compare equal to server echoes), reverse fader
// mapping (CDJ pitch), and jog wrap-around at ±180°.

import { describe, expect, it } from "bun:test";
import {
  angleDelta,
  applyDrag,
  faderDragToValueDelta,
  faderPosition,
  jogDegreesToSeconds,
  pointerAngle,
  quantize,
  roundToStep,
  snapToDetent,
} from "../math";

describe("snapToDetent", () => {
  it("captures values within ±3% of the range and releases just outside", () => {
    // range -1..1 → 3% = 0.06
    expect(snapToDetent(0.059, 0, -1, 1)).toBe(0);
    expect(snapToDetent(-0.06, 0, -1, 1)).toBe(0);
    expect(snapToDetent(0.061, 0, -1, 1)).toBe(0.061);
  });

  it("scales the zone with the range, not absolute units", () => {
    // pitch ±8 %: range 16 → zone ±0.48
    expect(snapToDetent(0.45, 0, -8, 8)).toBe(0);
    expect(snapToDetent(0.5, 0, -8, 8)).toBe(0.5);
  });
});

describe("drag accumulation", () => {
  const opts = { min: 0, max: 1, pixelsForFullRange: 200 };

  it("fine mode moves 10× slower", () => {
    expect(applyDrag(0.5, 20, opts)).toBeCloseTo(0.6);
    expect(applyDrag(0.5, 20, { ...opts, fine: true })).toBeCloseTo(0.51);
  });

  it("clamps the raw value so overshoot doesn't need unwinding", () => {
    const over = applyDrag(0.9, 400, opts);
    expect(over).toBe(1);
    expect(applyDrag(over, -20, opts)).toBeCloseTo(0.9);
  });

  it("a slow drag out of the detent escapes once past the zone (raw is not snapped)", () => {
    let raw = 0;
    const q = (r: number) => quantize(r, { min: -1, max: 1, detent: 0 });
    const seen: number[] = [];
    for (let i = 0; i < 10; i++) {
      raw = applyDrag(raw, 1, { min: -1, max: 1, pixelsForFullRange: 200 }); // +0.01 per px
      seen.push(q(raw));
    }
    expect(seen.slice(0, 5)).toEqual([0, 0, 0, 0, 0]); // 0.01 … 0.05 held at centre
    expect(seen[6]).toBeCloseTo(0.07); // escaped without having to "jump"
    expect(seen[9]).toBeCloseTo(0.1);
  });
});

describe("roundToStep", () => {
  it("removes binary float noise so echoes compare equal", () => {
    expect(roundToStep(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(roundToStep(0.7000000000000001, 0.05)).toBe(0.7);
    expect(roundToStep(0.15 * 3, 0.15)).toBe(0.45); // 0.44999999999999996 raw
  });

  it("counts steps from min, not from zero", () => {
    // min 0.5, step 2 → grid 0.5, 2.5, 4.5 …
    expect(roundToStep(3.4, 2, 0.5)).toBe(2.5);
    expect(roundToStep(3.6, 2, 0.5)).toBe(4.5);
  });

  it("handles exponent-notation steps", () => {
    expect(roundToStep(0.000000123456, 1e-7)).toBe(0.0000001);
  });

  it("quantize never rounds past the bounds", () => {
    // max isn't on the step grid: nearest step (1.0) would exceed 0.95
    expect(quantize(0.94, { min: 0, max: 0.95, step: 0.1 })).toBe(0.9);
    expect(quantize(0.96, { min: 0, max: 0.95, step: 0.1 })).toBeLessThanOrEqual(0.95);
  });
});

describe("fader mapping", () => {
  it("vertical: max at the top normally, min at the top when reversed (CDJ pitch)", () => {
    expect(faderPosition(8, -8, 8, "vertical")).toBe(0);
    expect(faderPosition(8, -8, 8, "vertical", true)).toBe(1);
    expect(faderPosition(-8, -8, 8, "vertical", true)).toBe(0);
  });

  it("horizontal: min at the left normally, right when reversed", () => {
    expect(faderPosition(0, 0, 1, "horizontal")).toBe(0);
    expect(faderPosition(0, 0, 1, "horizontal", true)).toBe(1);
  });

  it("dragging down lowers a normal fader but raises a reversed one, 1:1 with the track", () => {
    // 100 px track, range 0..1, drag 25 px down
    expect(faderDragToValueDelta(25, 100, 0, 1, "vertical")).toBeCloseTo(-0.25);
    expect(faderDragToValueDelta(25, 100, 0, 1, "vertical", true)).toBeCloseTo(0.25);
    expect(faderDragToValueDelta(25, 100, 0, 1, "horizontal")).toBeCloseTo(0.25);
    expect(faderDragToValueDelta(25, 100, 0, 1, "horizontal", true)).toBeCloseTo(-0.25);
  });

  it("the cap stays under the finger: position change equals drag distance / track length", () => {
    const before = faderPosition(0.4, 0, 1, "vertical", true);
    const after = faderPosition(0.4 + faderDragToValueDelta(30, 150, 0, 1, "vertical", true), 0, 1, "vertical", true);
    expect(after - before).toBeCloseTo(30 / 150);
  });
});

describe("jog", () => {
  it("angleDelta takes the short way across the ±180° seam", () => {
    expect(angleDelta(170, -170)).toBeCloseTo(20);
    expect(angleDelta(-170, 170)).toBeCloseTo(-20);
    expect(angleDelta(350, 10)).toBeCloseTo(20);
  });

  it("pointerAngle is 0 at 12 o'clock and increases clockwise (screen y points down)", () => {
    expect(pointerAngle(0, -1)).toBeCloseTo(0);
    expect(pointerAngle(1, 0)).toBeCloseTo(90);
    expect(angleDelta(pointerAngle(0, -1), pointerAngle(1, 0))).toBeCloseTo(90);
  });

  it("maps a full clockwise turn to +secondsPerTurn", () => {
    expect(jogDegreesToSeconds(360, 0.25)).toBeCloseTo(0.25);
    expect(jogDegreesToSeconds(-90, 0.25)).toBeCloseTo(-0.0625);
  });
});
