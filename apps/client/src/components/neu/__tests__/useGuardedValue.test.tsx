// The echo guard: while a user drags, server echoes of the value (arriving
// with network delay) must not move the control; after release, stale echoes
// of mid-drag values must not make it flicker back.

import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useGuardedValue } from "../useGuardedValue";

function setup(initial: number, holdMs = 1000) {
  const commits: number[] = [];
  const hook = renderHook(
    ({ value }: { value: number }) =>
      useGuardedValue({ value, min: 0, max: 1, holdMs, onCommit: (v) => commits.push(v) }),
    { initialProps: { value: initial } }
  );
  return { ...hook, commits };
}

describe("useGuardedValue", () => {
  it("ignores incoming values while dragging", () => {
    const { result, rerender } = setup(0.2);
    act(() => result.current.begin());
    act(() => result.current.update(0.5));
    rerender({ value: 0.3 }); // late echo of an earlier drag position
    expect(result.current.display).toBe(0.5);
  });

  it("after release, holds the committed value through stale echoes until the matching echo arrives", () => {
    const { result, rerender, commits } = setup(0.2);
    act(() => result.current.begin());
    act(() => result.current.update(0.6));
    act(() => result.current.end());
    expect(commits).toEqual([0.6]);

    rerender({ value: 0.4 }); // stale mid-drag echo
    expect(result.current.display).toBe(0.6);

    rerender({ value: 0.6 }); // our echo
    expect(result.current.display).toBe(0.6);

    rerender({ value: 0.9 }); // someone else moves it afterwards — follow immediately
    expect(result.current.display).toBe(0.9);
  });

  it("falls back to the prop when the echo never matches (server clamped / rejected)", async () => {
    const { result, rerender } = setup(0.2, 20);
    act(() => result.current.set(0.7));
    rerender({ value: 0.5 });
    expect(result.current.display).toBe(0.7);
    await act(() => new Promise((r) => setTimeout(r, 40)));
    expect(result.current.display).toBe(0.5);
  });

  it("a tap (cancel) emits nothing and keeps following the prop", () => {
    const { result, rerender, commits } = setup(0.2);
    act(() => result.current.begin());
    act(() => result.current.cancel());
    rerender({ value: 0.3 });
    expect(result.current.display).toBe(0.3);
    expect(commits).toEqual([]);
  });
});
