"use client";
import { NeuButton, NeuPanel, PadGrid } from "@/components/neu";
import { useCanDj, useGlobalStore } from "@/store/global";
import { useDjStore } from "@/store/dj";
import type { DeckCommand, DeckId } from "@beatsync/shared";
import { deckColor } from "../Deck";
import { DeckStrip } from "../DeckStrip";
import { Library } from "../Library";
import { Mixer } from "../Mixer";
import { VerticalWaveform } from "../VerticalWaveform";

/** Compact transport + hot cues under a vertical waveform column */
const CompactTransport = ({ deckId }: { deckId: DeckId }) => {
  const deck = useDjStore((s) => s.decks[deckId]);
  const send = useDjStore((s) => s.sendDeckCommand);
  const currentUser = useGlobalStore((s) => s.currentUser);
  const canMutate = useCanDj();
  const color = deckColor(deckId);
  const loaded = deck.status !== "empty" && !!deck.trackUrl;
  const lockedByOther = !!deck.lockedBy && deck.lockedBy.clientId !== currentUser?.clientId && !currentUser?.isAdmin;
  const disabled = !canMutate || lockedByOther;
  const cmd = (command: DeckCommand) => send(deckId, command);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        <NeuButton
          variant="transport"
          led={deck.status === "paused" && deck.anchorPositionSec === deck.cuePointSec ? "on" : "off"}
          ledColor="var(--neu-warn)"
          disabled={disabled || !loaded}
          onClick={() => cmd({ type: "CUE" })}
          aria-label={`Deck ${deckId} cue`}
        >
          CUE
        </NeuButton>
        <NeuButton
          variant="transport"
          led={deck.status === "playing" ? "on" : loaded ? "blink" : "off"}
          ledColor="var(--neu-ok)"
          disabled={disabled || !loaded}
          onClick={() => cmd({ type: deck.status === "playing" ? "PAUSE" : "PLAY" })}
          aria-label={deck.status === "playing" ? `Pause deck ${deckId}` : `Play deck ${deckId}`}
        >
          {deck.status === "playing" ? "❚❚" : "▶"}
        </NeuButton>
        <NeuButton size="sm" disabled={disabled || !loaded} onClick={() => cmd({ type: "SYNC" })} ledColor={color}>
          SYNC
        </NeuButton>
      </div>
      <PadGrid
        name={`Deck ${deckId} hot cue`}
        color={color}
        disabled={disabled || !loaded}
        pads={deck.hotCues.map((cue, i) => (cue ? { color: cue.color, label: String.fromCharCode(65 + i) } : null))}
        onPress={(index) => cmd({ type: "JUMP_HOT_CUE", index })}
        onClear={(index) => cmd({ type: "DELETE_HOT_CUE", index })}
        className="w-full max-w-[12rem]"
      />
    </div>
  );
};

/**
 * Serato-style arrangement: compact deck info strips up top, two parallel
 * vertical waveforms scrolling top→bottom in the centre, compact
 * transport/pads under each, mixer centre-bottom, library below.
 */
export const VerticalLayout = () => (
  <div className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="grid shrink-0 grid-cols-2 gap-3">
      <DeckStrip deckId="A" />
      <DeckStrip deckId="B" />
    </div>
    <NeuPanel className="grid shrink-0 grid-cols-2 gap-2 p-2" variant="inset">
      <VerticalWaveform deckId="A" className="h-64 w-full rounded-lg" />
      <VerticalWaveform deckId="B" className="h-64 w-full rounded-lg" />
    </NeuPanel>
    <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-start gap-3">
      <CompactTransport deckId="A" />
      <Mixer />
      <CompactTransport deckId="B" />
    </div>
    <Library className="min-h-[14rem] flex-1" />
  </div>
);
