"use client";
import { NeuButton, PadGrid } from "@/components/neu";
import { cn } from "@/lib/utils";
import { getBeatGrid, useDjStore } from "@/store/dj";
import { useCanDj, useGlobalStore } from "@/store/global";
import type { DeckCommand, DeckId } from "@beatsync/shared";
import { deckColor } from "./Deck";

const LOOP_BEATS = 4;

/**
 * Compact transport: CUE / PLAY / SYNC, an optional single 4-beat loop
 * toggle, and an optional hot-cue pad grid. Used anywhere a full `Deck`
 * panel would take too much room (`VerticalLayout`'s waveform column,
 * `BrowseLayout`'s slim deck strips).
 */
export const CompactTransport = ({
  deckId,
  className,
  padGrid = true,
  loopToggle = false,
  layout = "column",
}: {
  deckId: DeckId;
  className?: string;
  /** Show the hot-cue pad grid below/after the transport buttons. Default true. */
  padGrid?: boolean;
  /** Show a single toggle for a 4-beat loop. Default false. */
  loopToggle?: boolean;
  /** "column" stacks buttons above the pad grid; "row" keeps everything in one slim line. */
  layout?: "column" | "row";
}) => {
  const deck = useDjStore((s) => s.decks[deckId]);
  // Minimal single-entry record: avoids subscribing to the whole tracks map
  // (see Deck.tsx), only needed to resolve the beat grid for the loop toggle.
  const track = useDjStore((s) => (loopToggle && deck.trackUrl ? s.tracks[deck.trackUrl] : undefined));
  const send = useDjStore((s) => s.sendDeckCommand);
  const currentUser = useGlobalStore((s) => s.currentUser);
  const canMutate = useCanDj();
  const color = deckColor(deckId);
  const loaded = deck.status !== "empty" && !!deck.trackUrl;
  const lockedByOther = !!deck.lockedBy && deck.lockedBy.clientId !== currentUser?.clientId && !currentUser?.isAdmin;
  const disabled = !canMutate || lockedByOther;
  const cmd = (command: DeckCommand) => send(deckId, command);

  const grid = loopToggle ? getBeatGrid(deck.trackUrl, deck.trackUrl && track ? { [deck.trackUrl]: track } : {}) : null;
  const loopActive =
    loopToggle &&
    !!deck.loop &&
    !!grid &&
    Math.abs((deck.loop.endSec - deck.loop.startSec) * (grid.bpm / 60) - LOOP_BEATS) < 0.01;

  return (
    <div className={cn(layout === "row" ? "flex items-center gap-2" : "flex flex-col items-center gap-2", className)}>
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
        {loopToggle && (
          <NeuButton
            size="sm"
            active={loopActive}
            disabled={disabled || !loaded}
            onClick={() => (loopActive ? cmd({ type: "LOOP_EXIT" }) : cmd({ type: "LOOP_AUTO", beats: LOOP_BEATS }))}
            aria-label={`Deck ${deckId} 4 beat loop`}
          >
            {LOOP_BEATS}
          </NeuButton>
        )}
      </div>
      {padGrid && (
        <PadGrid
          name={`Deck ${deckId} hot cue`}
          color={color}
          disabled={disabled || !loaded}
          pads={deck.hotCues.map((cue, i) => (cue ? { color: cue.color, label: String.fromCharCode(65 + i) } : null))}
          onPress={(index) => cmd({ type: "JUMP_HOT_CUE", index })}
          onClear={(index) => cmd({ type: "DELETE_HOT_CUE", index })}
          className="w-full max-w-[12rem]"
        />
      )}
    </div>
  );
};
