const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Convert a musical key ("A minor", "F#m", "Bb major", "8A") to Camelot
 * notation. Returns undefined when it can't be parsed.
 */
export function toCamelot(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const input = raw
    .trim()
    .replace(/\s+sharp\b/i, "#")
    .replace(/\s+flat\b/i, "b")
    .replace(/♯/g, "#")
    .replace(/♭/g, "b");

  const camelot = /^0?(1[0-2]|[1-9])([AB])$/i.exec(input);
  if (camelot) return `${camelot[1]}${camelot[2].toUpperCase()}`;

  const match = /^([A-Ga-g])([#b]?)\s*(major|maj|minor|min|m)?$/i.exec(input);
  if (!match) return undefined;
  const [, letter, accidental, quality] = match;
  let pc = PITCH_CLASS[letter.toUpperCase()];
  if (accidental === "#") pc += 1;
  if (accidental === "b") pc -= 1;
  pc = (pc + 12) % 12;

  // "m" alone means minor; "M"/"maj"/"major"/nothing means major
  const isMinor = quality !== undefined && (/^min/i.test(quality) || quality === "m");
  // Circle of fifths: C major = 8B, A minor = 8A (relative major is +3 semitones)
  const base = isMinor ? (pc + 3) % 12 : pc;
  const number = ((base * 7 + 7) % 12) + 1;
  return `${number}${isMinor ? "A" : "B"}`;
}
