/**
 * Console layout presets. Each recreates the on-screen ARRANGEMENT of a
 * popular DJ app (panel positions, waveform orientation, deck info density)
 * using Beersync's own neumorphic components and deck colours — no logos,
 * no copied colour schemes or icons.
 */
export type LayoutId = "performance" | "vertical" | "essential" | "browse" | "turntable";

export interface LayoutMeta {
  id: LayoutId;
  label: string;
  /** Descriptive callout only — never a trademarked name used as branding */
  inspiredBy: string;
  description: string;
}

export const LAYOUTS: LayoutMeta[] = [
  {
    id: "performance",
    label: "Performance",
    inspiredBy: "rekordbox-style",
    description: "Stacked zoomed waveforms up top, decks flanking the mixer, library below.",
  },
  {
    id: "vertical",
    label: "Vertical",
    inspiredBy: "Serato-style",
    description: "Compact deck headers with two tall parallel waveforms scrolling top to bottom.",
  },
  {
    id: "essential",
    label: "Essential",
    inspiredBy: "Traktor-style",
    description: "Full deck panels with built-in waveforms side by side around the mixer.",
  },
  {
    id: "browse",
    label: "Browse",
    inspiredBy: "rekordbox browse-style",
    description: "Library takes centre stage; slim deck strips and a crossfader-only mixer.",
  },
  {
    id: "turntable",
    label: "Turntable",
    inspiredBy: "djay-style",
    description: "Large jog wheels front and centre with the mixer between them.",
  },
];

export const DEFAULT_LAYOUT: LayoutId = "performance";

export const isLayoutId = (value: unknown): value is LayoutId =>
  typeof value === "string" && LAYOUTS.some((l) => l.id === value);
