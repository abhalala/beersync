"use client";
import { MAX_NTP_MEASUREMENTS, useGlobalStore } from "@/store/global";
import { useDjStore } from "@/store/dj";
import { cn } from "@/lib/utils";
import { ControllerButton } from "./ControllerButton";
import { LayoutButton } from "./layouts/LayoutButton";
import type { LayoutId } from "./layouts/types";
import { Check, Copy, Crown, Headphones, Moon, PartyPopper, SlidersHorizontal, Sun, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

interface ConsoleTopBarProps {
  roomId: string;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  onToggleCrew?: () => void;
  crewOpen?: boolean;
  /** Beer holders can flip between the decks and the listener view */
  view?: "decks" | "listener";
  onToggleView?: () => void;
  /** Desktop layout preset (per device) */
  layout?: LayoutId;
  onLayoutChange?: (layout: LayoutId) => void;
}

export const ConsoleTopBar = ({
  roomId,
  theme = "dark",
  onToggleTheme,
  onToggleCrew,
  crewOpen,
  view,
  onToggleView,
  layout,
  onLayoutChange,
}: ConsoleTopBarProps) => {
  const isSynced = useGlobalStore((s) => s.isSynced);
  // Lost sync after audio started (reconnect mid-set): the console stays up
  const isResyncing = useGlobalStore((s) => !s.isSynced && s.hasUserStartedSystem && !s.isInitingSystem);
  const rtt = useGlobalStore((s) => s.roundTripEstimate);
  const measurements = useGlobalStore((s) => s.syncMeasurements.length);
  const clients = useGlobalStore((s) => s.connectedClients);
  const currentUser = useGlobalStore((s) => s.currentUser);
  const decks = useDjStore((s) => s.decks);
  const [copied, setCopied] = useState(false);

  const djs = new Set(
    Object.values(decks)
      .flatMap((d) => [d.lockedBy?.username, d.lastActor?.username])
      .filter((name): name is string => !!name)
  );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (permissions); the room code is visible anyway
    }
  };

  const syncColor = !isSynced ? "var(--neu-warn)" : rtt > 150 ? "var(--neu-warn)" : "var(--neu-ok)";

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 px-3 sm:px-4">
      <Link href="/" className="font-[family-name:var(--font-display)] text-base font-bold tracking-wide">
        Beer<span className="text-[var(--deck-a)]">sy</span>
        <span className="text-[var(--deck-b)]">nc</span>
      </Link>

      <button
        type="button"
        onClick={copyLink}
        className="neu-chip flex items-center gap-1.5 font-mono text-xs"
        title="Copy the sesh invite link"
      >
        <span className="font-sans text-[var(--neu-muted)]">sesh</span> {roomId}
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>

      <div
        className={cn(
          "items-center gap-1.5 font-mono text-[11px] text-[var(--neu-muted)]",
          isResyncing ? "flex" : "hidden sm:flex"
        )}
        title={isResyncing ? "Connection dropped; re-syncing the clock with the room" : "Clock sync with the room"}
        role={isResyncing ? "status" : undefined}
      >
        <span
          className={cn("size-2 rounded-full", isResyncing && "animate-pulse")}
          style={{ background: syncColor, boxShadow: `0 0 6px ${syncColor}` }}
        />
        {isSynced
          ? `${rtt.toFixed(0)} ms`
          : isResyncing
            ? "Resyncing…"
            : `sync ${measurements}/${MAX_NTP_MEASUREMENTS}`}
      </div>

      {djs.size > 0 && (
        <div className="hidden truncate text-xs text-[var(--neu-muted)] md:block">
          On decks: <span className="text-[var(--neu-text)]">{[...djs].join(", ")}</span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {currentUser?.isAdmin && <Crown className="size-4 text-[var(--neu-warn)]" aria-label="You are the sesh host" />}
        {view === "decks" && layout && onLayoutChange && <LayoutButton layout={layout} onChange={onLayoutChange} />}
        {view === "decks" && <ControllerButton />}
        {view && (
          <button
            type="button"
            onClick={onToggleView}
            className="neu-chip flex items-center gap-1.5 text-xs"
            title="Switch view"
          >
            {view === "decks" ? <Headphones className="size-3.5" /> : <SlidersHorizontal className="size-3.5" />}
            {view === "decks" ? "Listen" : "Decks"}
          </button>
        )}
        <Link
          href={`/room/${roomId}/party`}
          className="neu-chip hidden items-center gap-1.5 text-xs sm:flex"
          title="Beatsync listening-party view"
        >
          <PartyPopper className="size-3.5" /> Party mode
        </Link>
        <button
          type="button"
          onClick={onToggleCrew}
          aria-pressed={crewOpen}
          className="neu-chip flex items-center gap-1.5 text-xs"
          title="People, permissions and chat"
        >
          <Users className="size-3.5" /> {clients.length}
        </button>
        <button
          type="button"
          onClick={onToggleTheme}
          className="neu-chip grid size-8 place-items-center p-0"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </button>
      </div>
    </header>
  );
};
