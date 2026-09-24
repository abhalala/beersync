import { useDjStore } from "@/store/dj";
import type { DeckCommand, DeckId } from "@beatsync/shared";
import { useEffect } from "react";
import { toast } from "sonner";

// Keyboard layout: left hand drives deck A, right hand deck B.
//   A: Q cue · W play/pause · E sync · 1-4 hot cues · S 4-beat loop
//   B: I cue · O play/pause · P sync · 7-0 hot cues · L 4-beat loop
//   Crossfader: [ and ] move it, \ centres it · ? shows this list
const HOT_CUE_KEYS: Record<string, [DeckId, number]> = {
  "1": ["A", 0],
  "2": ["A", 1],
  "3": ["A", 2],
  "4": ["A", 3],
  "7": ["B", 0],
  "8": ["B", 1],
  "9": ["B", 2],
  "0": ["B", 3],
};

export const SHORTCUT_HELP =
  "Deck A: Q cue · W play · E sync · 1–4 hot cues · S loop\nDeck B: I cue · O play · P sync · 7–0 hot cues · L loop\nCrossfader: [ ] move · \\ centre";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.getAttribute("role") === "slider");

export const useDeckShortcuts = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const { decks, mixer, sendDeckCommand, sendMixerPatch } = useDjStore.getState();
      const cmd = (deckId: DeckId, command: DeckCommand) => {
        event.preventDefault();
        sendDeckCommand(deckId, command);
      };
      const togglePlay = (deckId: DeckId) =>
        cmd(deckId, { type: decks[deckId].status === "playing" ? "PAUSE" : "PLAY" });
      const toggleLoop = (deckId: DeckId) =>
        cmd(deckId, decks[deckId].loop ? { type: "LOOP_EXIT" } : { type: "LOOP_AUTO", beats: 4 });

      const key = event.key.toLowerCase();
      const hotCue = HOT_CUE_KEYS[key];
      if (hotCue) return cmd(hotCue[0], { type: "JUMP_HOT_CUE", index: hotCue[1] });

      switch (key) {
        case "q":
          return cmd("A", { type: "CUE" });
        case "w":
          return togglePlay("A");
        case "e":
          return cmd("A", { type: "SYNC" });
        case "s":
          return toggleLoop("A");
        case "i":
          return cmd("B", { type: "CUE" });
        case "o":
          return togglePlay("B");
        case "p":
          return cmd("B", { type: "SYNC" });
        case "l":
          return toggleLoop("B");
        case "[":
          event.preventDefault();
          return sendMixerPatch({ crossfader: Math.max(-1, mixer.crossfader - 0.1) });
        case "]":
          event.preventDefault();
          return sendMixerPatch({ crossfader: Math.min(1, mixer.crossfader + 0.1) });
        case "\\":
          event.preventDefault();
          return sendMixerPatch({ crossfader: 0 });
        case "?":
          toast("Keyboard shortcuts", { description: SHORTCUT_HELP, id: "shortcuts", duration: 8000 });
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
};
