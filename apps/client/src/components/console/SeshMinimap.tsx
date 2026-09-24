"use client";
import { cn } from "@/lib/utils";
import { getBeatGrid, getDeckDisplayPosition, useDjStore } from "@/store/dj";
import { useGlobalStore } from "@/store/global";
import { useSeshStore } from "@/store/sesh";
import type { ClientDataType } from "@beatsync/shared";
import { beatPhase, GRID, PlaybackControlsPermissionsEnum } from "@beatsync/shared";
import { Beer, ChevronDown, Crown, Hand, Users } from "lucide-react";
import { useRef, useState } from "react";
import { useAnimationFrame } from "./useAnimationFrame";

type Role = "host" | "holder" | "listener";

const roleOf = (client: ClientDataType, openBar: boolean): Role =>
  client.isAdmin ? "host" : client.isBeerHolder || openBar ? "holder" : "listener";

const ROLE_LABEL: Record<Role, string> = { host: "Host", holder: "Beer holder", listener: "Listener" };

/**
 * The sesh minimap: a little radar in the corner showing who is here, who holds
 * a beer (deck access), who wants one, and live reactions. It pulses on the
 * master deck's beat so the whole room visibly breathes with the mix.
 */
export const SeshMinimap = ({ className }: { className?: string }) => {
  const [open, setOpen] = useState(false);
  const clients = useGlobalStore((s) => s.connectedClients);
  const me = useGlobalStore((s) => s.currentUser);
  const openBar = useGlobalStore(
    (s) => s.playbackControlsPermissions === PlaybackControlsPermissionsEnum.enum.EVERYONE
  );
  const decks = useDjStore((s) => s.decks);
  const reactions = useSeshStore((s) => s.reactions);
  const { passBeer, requestBeer, setOpenBar } = useSeshStore();
  const rootRef = useRef<HTMLDivElement>(null);

  // Beat pulse from the master deck (or whichever deck is playing)
  useAnimationFrame(() => {
    const el = rootRef.current;
    if (!el) return;
    const { decks, mixer, tracks } = useDjStore.getState();
    const id =
      mixer.masterDeck && decks[mixer.masterDeck].status === "playing"
        ? mixer.masterDeck
        : (["A", "B"] as const).find((d) => decks[d].status === "playing");
    const grid = id ? getBeatGrid(decks[id].trackUrl, tracks) : null;
    // Sharp attack, smooth decay; 0 when nothing is playing
    const energy = id && grid ? Math.pow(1 - beatPhase(getDeckDisplayPosition(id), grid), 3) : 0;
    el.style.setProperty("--beat", energy.toFixed(3));
  });

  const deckOf = (clientId: string) =>
    (["A", "B"] as const).find(
      (d) => decks[d].lockedBy?.clientId === clientId || decks[d].lastActor?.clientId === clientId
    );

  const iCanPass = !!me && (me.isAdmin || me.isBeerHolder);
  const requests = clients.filter((c) => c.wantsBeer && !c.isBeerHolder && !c.isAdmin);
  const myRole = me ? roleOf(me, openBar) : "listener";

  const radar = (size: number) => (
    <div
      className="relative shrink-0 overflow-hidden rounded-full neu-inset-sm"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <div className="sesh-pulse absolute inset-0 rounded-full" />
      {/* rings */}
      <div className="absolute inset-[22%] rounded-full border border-[var(--neu-line)]" />
      <div className="absolute inset-[42%] rounded-full border border-[var(--neu-line)]" />
      {clients.map((client) => {
        const role = roleOf(client, openBar);
        const deck = deckOf(client.clientId);
        const x = (client.position.x / GRID.SIZE) * 100;
        const y = (client.position.y / GRID.SIZE) * 100;
        const isMe = client.clientId === me?.clientId;
        const color =
          deck === "A"
            ? "var(--deck-a)"
            : deck === "B"
              ? "var(--deck-b)"
              : role === "listener"
                ? "var(--neu-muted)"
                : "var(--neu-warn)";
        const bubble = [...reactions].reverse().find((r) => r.clientId === client.clientId);
        return (
          <div
            key={client.clientId}
            className="absolute"
            style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
          >
            <div
              className={cn("grid place-items-center rounded-full text-[9px]", client.wantsBeer && "animate-pulse")}
              style={{
                width: role === "listener" ? 8 : 16,
                height: role === "listener" ? 8 : 16,
                background: role === "listener" ? color : "var(--neu-bg)",
                boxShadow: `0 0 0 ${isMe ? 2 : 1}px ${isMe ? "var(--neu-text)" : color}, 0 0 8px ${color}`,
              }}
            >
              {role !== "listener" && "🍺"}
            </div>
            {bubble && (
              <span key={bubble.id} className="sesh-float pointer-events-none absolute left-1/2 top-0 text-sm">
                {bubble.emoji}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div ref={rootRef} className={cn("pointer-events-auto flex flex-col items-end gap-2", className)}>
      {open && (
        <div
          className="neu-popover flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 p-3"
          role="dialog"
          aria-label="People in this sesh"
        >
          <div className="flex items-center gap-3">
            {radar(96)}
            <div className="min-w-0 text-xs">
              <div className="font-[family-name:var(--font-display)] text-sm font-semibold">The sesh</div>
              <div className="text-[var(--neu-muted)]">
                {clients.filter((c) => roleOf(c, openBar) !== "listener").length} holding a beer · {clients.length} here
              </div>
              <div className="mt-1 text-[var(--neu-muted)]">
                You: <span className="text-[var(--neu-text)]">{ROLE_LABEL[myRole]}</span>
              </div>
            </div>
          </div>

          {me?.isAdmin && (
            <label className="flex items-center justify-between gap-2 text-xs">
              <span>
                Open bar <span className="text-[var(--neu-muted)]">(everyone can DJ)</span>
              </span>
              <input
                id="sesh-open-bar"
                type="checkbox"
                checked={openBar}
                onChange={(e) => setOpenBar(e.target.checked)}
              />
            </label>
          )}

          {myRole === "listener" && (
            <button
              type="button"
              className="neu-chip justify-center py-1.5 text-xs"
              onClick={() => requestBeer(!me?.wantsBeer)}
            >
              <Hand className="size-3.5" /> {me?.wantsBeer ? "Cancel request" : "Ask for a beer (join the decks)"}
            </button>
          )}

          {iCanPass && requests.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--neu-warn)]">
                Wants a beer
              </div>
              {requests.map((c) => (
                <div key={c.clientId} className="flex items-center gap-2 text-xs">
                  <Hand className="size-3 text-[var(--neu-warn)]" />
                  <span className="min-w-0 flex-1 truncate">{c.username}</span>
                  <button type="button" className="neu-chip text-[11px]" onClick={() => passBeer(c.clientId, true)}>
                    Pass 🍺
                  </button>
                </div>
              ))}
            </div>
          )}

          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto text-xs">
            {clients.map((c) => {
              const role = roleOf(c, openBar);
              const isMe = c.clientId === me?.clientId;
              const deck = deckOf(c.clientId);
              return (
                <li key={c.clientId} className="flex items-center gap-2">
                  {role === "host" ? (
                    <Crown className="size-3.5 text-[var(--neu-warn)]" />
                  ) : role === "holder" ? (
                    <Beer className="size-3.5 text-[var(--neu-warn)]" />
                  ) : (
                    <Users className="size-3.5 text-[var(--neu-muted)]" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {c.username}
                    {isMe && <span className="text-[var(--neu-muted)]"> (you)</span>}
                    {deck && (
                      <span
                        className="ml-1 font-mono text-[10px] font-bold"
                        style={{ color: deck === "A" ? "var(--deck-a)" : "var(--deck-b)" }}
                      >
                        {deck}
                      </span>
                    )}
                  </span>
                  {!openBar && role === "listener" && iCanPass && (
                    <button type="button" className="neu-chip text-[11px]" onClick={() => passBeer(c.clientId, true)}>
                      Pass 🍺
                    </button>
                  )}
                  {!openBar && role === "holder" && (me?.isAdmin || isMe) && (
                    <button type="button" className="neu-chip text-[11px]" onClick={() => passBeer(c.clientId, false)}>
                      {isMe ? "Put down" : "Take back"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Hide the sesh minimap" : `Show the sesh minimap (${clients.length} people)`}
        className="neu-popover relative flex items-center gap-2 rounded-full p-1.5 pr-3"
      >
        {radar(44)}
        <span className="flex flex-col items-start leading-tight">
          <span className="font-[family-name:var(--font-display)] text-xs font-semibold">Sesh</span>
          <span className="font-mono text-[10px] text-[var(--neu-muted)]">{clients.length} here</span>
        </span>
        {requests.length > 0 && iCanPass && (
          <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-[var(--neu-warn)] text-[10px] font-bold text-black">
            {requests.length}
          </span>
        )}
        <ChevronDown className={cn("size-3.5 text-[var(--neu-muted)] transition-transform", !open && "rotate-180")} />
      </button>
    </div>
  );
};
