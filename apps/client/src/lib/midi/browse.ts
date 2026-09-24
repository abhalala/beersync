import type { DeckId } from "@beatsync/shared";

// The library registers itself here so hardware (the FLX4 browse knob and
// LOAD buttons) can move its selection and load the selected row.

export interface BrowseTarget {
  move: (delta: number) => void;
  load: (deckId: DeckId) => void;
}

let target: BrowseTarget | null = null;

export const registerBrowseTarget = (next: BrowseTarget) => {
  target = next;
  return () => {
    if (target === next) target = null;
  };
};

export const getBrowseTarget = () => target;
