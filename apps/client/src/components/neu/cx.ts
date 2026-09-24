/** Tiny className joiner (keeps this module free of app-level imports). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Movement below this (px) is a tap, not a drag. */
export const TAP_SLOP_PX = 3;

/** Two taps within this window reset a control to its default. */
export const DOUBLE_TAP_MS = 300;

/** Touch long-press duration for destructive pad actions. */
export const LONG_PRESS_MS = 500;
