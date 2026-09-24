import { AudiusAdapter } from "@/sources/audius";
import { JamendoAdapter } from "@/sources/jamendo";
import { ProviderAdapter } from "@/sources/provider";
import type { MusicSourceAdapter } from "@/sources/types";
import { UrlAdapter } from "@/sources/url";

export type { MusicSourceAdapter } from "@/sources/types";

const ADAPTERS: MusicSourceAdapter[] = [
  new AudiusAdapter(),
  new JamendoAdapter(),
  new ProviderAdapter(),
  new UrlAdapter(),
];

/** Enabled adapters, in display order */
export function getSources(): MusicSourceAdapter[] {
  return ADAPTERS.filter((a) => a.isEnabled());
}

/** An enabled adapter by id, or undefined */
export function getSource(id: string): MusicSourceAdapter | undefined {
  return ADAPTERS.find((a) => a.info.id === id && a.isEnabled());
}
