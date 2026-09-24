// While a DJ drags a fader, the server broadcasts DJ_MIXER_STATE ~20x/s via
// applyMixerState, which replaces s.mixer (and every nested channel object)
// wholesale. Components must select only the primitive fields they render,
// or shallow-compare, so an unrelated deck's fader move doesn't re-render them.

import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useShallow } from "zustand/react/shallow";
import { createDefaultMixer } from "@beatsync/shared";
import { useDjStore } from "@/store/dj";

describe("useDjStore mixer selectors", () => {
  it("a channel selected with useShallow does not re-render when the OTHER deck's channel changes", () => {
    useDjStore.getState().reset();
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useDjStore(useShallow((s) => s.mixer.channels.A));
    });
    expect(renders).toBe(1);
    const initialA = result.current;

    // Simulate ~20 broadcasts/s of DJ_MIXER_STATE while another DJ drags deck B's fader
    act(() => {
      for (let i = 0; i < 5; i++) {
        const mixer = createDefaultMixer();
        mixer.version = i + 1;
        mixer.channels.B = { ...mixer.channels.B, fader: 0.1 * i };
        useDjStore.getState().applyMixerState(mixer);
      }
    });

    expect(renders).toBe(1); // channel A's values never changed, so no re-render
    expect(result.current).toBe(initialA); // same reference too: useShallow bailed out
  });

  it("a channel selected with useShallow DOES re-render when its own fields change", () => {
    useDjStore.getState().reset();
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useDjStore(useShallow((s) => s.mixer.channels.A));
    });
    expect(renders).toBe(1);

    act(() => {
      const mixer = createDefaultMixer();
      mixer.version = 1;
      mixer.channels.A = { ...mixer.channels.A, fader: 0.42 };
      useDjStore.getState().applyMixerState(mixer);
    });

    expect(renders).toBe(2);
    expect(result.current.fader).toBe(0.42);
  });

  it("a primitive field selector (e.g. crossfaderCurve) does not re-render on unrelated mixer broadcasts", () => {
    useDjStore.getState().reset();
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useDjStore((s) => s.mixer.crossfaderCurve);
    });
    expect(renders).toBe(1);

    act(() => {
      for (let i = 0; i < 5; i++) {
        const mixer = createDefaultMixer();
        mixer.version = i + 1;
        mixer.channels.A = { ...mixer.channels.A, fader: 0.1 * i };
        useDjStore.getState().applyMixerState(mixer);
      }
    });

    expect(renders).toBe(1);
    expect(result.current).toBe("smooth");
  });
});
