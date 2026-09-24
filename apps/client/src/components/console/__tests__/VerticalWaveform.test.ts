// timeToY is the only place that decides where a beat/cue line lands on the
// vertical waveform; a sign or scale slip here would silently draw cues in
// the wrong place with nothing else catching it (canvas output isn't asserted).

import { describe, expect, it } from "bun:test";
import { timeToY } from "../VerticalWaveform";

describe("timeToY", () => {
  it("places the current position exactly at the playhead line", () => {
    expect(timeToY(10, 10, 400, 40, 0.18)).toBeCloseTo(400 * 0.18);
  });

  it("maps future time below the playhead (scrolls down)", () => {
    const playheadY = 400 * 0.18;
    expect(timeToY(11, 10, 400, 40, 0.18)).toBeCloseTo(playheadY + 40);
  });

  it("maps past time above the playhead (scrolled out)", () => {
    const playheadY = 400 * 0.18;
    expect(timeToY(9, 10, 400, 40, 0.18)).toBeCloseTo(playheadY - 40);
  });

  it("scales linearly with pxPerSec", () => {
    const a = timeToY(12, 10, 400, 20, 0.18);
    const b = timeToY(12, 10, 400, 40, 0.18);
    const playheadY = 400 * 0.18;
    expect(b - playheadY).toBeCloseTo((a - playheadY) * 2);
  });
});
