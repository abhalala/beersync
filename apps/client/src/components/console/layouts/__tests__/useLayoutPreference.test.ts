// Bad/missing localStorage values must never surface as an unhandled layout
// id downstream (ConsoleLayout's switch would silently render nothing for
// an id it doesn't recognize) — falling back to "performance" is load-bearing.

import { describe, expect, it, beforeEach } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useLayoutPreference } from "../useLayoutPreference";

const KEY = "beersync-console-layout";

beforeEach(() => {
  localStorage.clear();
});

describe("useLayoutPreference", () => {
  it("falls back to performance when nothing is stored", () => {
    const { result } = renderHook(() => useLayoutPreference());
    expect(result.current[0]).toBe("performance");
  });

  it("falls back to performance on an unknown stored value", () => {
    localStorage.setItem(KEY, "reason-8-deck-mode");
    const { result } = renderHook(() => useLayoutPreference());
    expect(result.current[0]).toBe("performance");
  });

  it("reads back a valid stored value", () => {
    localStorage.setItem(KEY, "vertical");
    const { result } = renderHook(() => useLayoutPreference());
    expect(result.current[0]).toBe("vertical");
  });

  it("persists a change and reflects it on the next render", () => {
    const { result, rerender } = renderHook(() => useLayoutPreference());
    act(() => result.current[1]("turntable"));
    rerender();
    expect(result.current[0]).toBe("turntable");
    expect(localStorage.getItem(KEY)).toBe("turntable");
  });
});
