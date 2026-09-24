// Musical keys in Camelot notation (1A-12A minor, 1B-12B major) for harmonic mixing.

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

// Camelot number for each pitch class (index = semitones above C)
const MAJOR_CAMELOT = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const MINOR_CAMELOT = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

/** Pitch class (0 = C) + mode to Camelot, e.g. (9, "minor") -> "8A" */
export const toCamelot = (pitchClass: number, mode: "major" | "minor"): string => {
  const pc = ((pitchClass % 12) + 12) % 12;
  return mode === "major" ? `${MAJOR_CAMELOT[pc]}B` : `${MINOR_CAMELOT[pc]}A`;
};

/** Camelot to a readable key name, e.g. "8A" -> "Am" */
export const camelotToKeyName = (camelot: string): string | null => {
  const parsed = parseCamelot(camelot);
  if (!parsed) return null;
  const table = parsed.letter === "B" ? MAJOR_CAMELOT : MINOR_CAMELOT;
  const pc = table.indexOf(parsed.number);
  return `${PITCH_CLASSES[pc]}${parsed.letter === "A" ? "m" : ""}`;
};

const parseCamelot = (camelot: string): { number: number; letter: "A" | "B" } | null => {
  const match = /^(1[0-2]|[1-9])([AB])$/.exec(camelot.trim().toUpperCase());
  if (!match) return null;
  return { number: Number(match[1]), letter: match[2] as "A" | "B" };
};

/**
 * Harmonic compatibility on the Camelot wheel: same key, ±1 step with the same
 * letter, or the relative major/minor (same number, other letter).
 */
export const isHarmonicMatch = (a: string | undefined, b: string | undefined): boolean => {
  if (!a || !b) return false;
  const ka = parseCamelot(a);
  const kb = parseCamelot(b);
  if (!ka || !kb) return false;
  if (ka.number === kb.number) return true;
  if (ka.letter !== kb.letter) return false;
  const diff = (ka.number - kb.number + 12) % 12;
  return diff === 1 || diff === 11;
};
