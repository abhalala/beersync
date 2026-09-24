"use client";
import { useMidiStore } from "@/lib/midi/controller";
import { cn } from "@/lib/utils";
import { Cable } from "lucide-react";
import { useState } from "react";

const STATUS_TEXT: Record<string, string> = {
  idle: "Connect controller",
  connecting: "Connecting…",
  connected: "FLX4",
  "not-found": "Plug in the FLX4",
  denied: "MIDI blocked",
  unsupported: "No MIDI",
};

const STATUS_HINT: Record<string, string> = {
  idle: "Connect a Pioneer DDJ-FLX4 over USB",
  "not-found": "No DDJ-FLX4 found. Plug it in over USB; it connects automatically.",
  denied: "The browser blocked MIDI access. Allow it in site settings and try again.",
  unsupported: "This browser has no Web MIDI. Use Chrome or Edge on desktop or Android.",
};

/** Top-bar control for the Pioneer DDJ-FLX4 (Web MIDI) */
export const ControllerButton = () => {
  const { status, deviceName, invertTempo, connect, disconnect, setInvertTempo } = useMidiStore();
  const [open, setOpen] = useState(false);
  const connected = status === "connected";

  return (
    <div className="relative hidden sm:block">
      <button
        type="button"
        className="neu-chip flex items-center gap-1.5 text-xs"
        title={connected ? `${deviceName} connected` : STATUS_HINT[status]}
        aria-expanded={connected ? open : undefined}
        disabled={status === "unsupported" || status === "connecting"}
        onClick={() => (connected ? setOpen((o) => !o) : void connect())}
      >
        <span
          className={cn("size-2 rounded-full", connected ? "bg-[var(--neu-ok)]" : "bg-[var(--neu-muted)]")}
          aria-hidden
        />
        <Cable className="size-3.5" />
        {STATUS_TEXT[status]}
      </button>
      {connected && open && (
        <div
          className="neu-popover absolute top-10 right-0 z-50 flex w-64 flex-col gap-2 p-3 text-xs"
          role="dialog"
          aria-label="Controller"
        >
          <div className="font-semibold">{deviceName}</div>
          <p className="text-[var(--neu-muted)]">
            Decks, pads (hot cue, beat jump, beat loop), jogs, tempo, EQ, filter, faders, crossfader and the browse knob
            with LOAD are mapped. The tempo fader takes over once it reaches the deck&apos;s current tempo.
          </p>
          <label className="flex items-center justify-between gap-2">
            Reverse tempo fader
            <input
              id="midi-invert-tempo"
              type="checkbox"
              checked={invertTempo}
              onChange={(e) => setInvertTempo(e.target.checked)}
            />
          </label>
          <button
            type="button"
            className="neu-chip justify-center"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
};
