# Beersync sync model

Beersync keeps Beatsync's core: one clock authority (the room server), an NTP-style
clock offset on every device, and actions scheduled for a shared future moment. On
top of that, every piece of state in the app belongs to exactly one of the sync
classes below. When you add a feature, pick its class first; the class decides the
message shape, conflict rule, and what a late joiner or a reconnecting device does.

## Topology

```
 DJ laptop ──┐                         ┌── listener phone
 DJ tablet ──┼── WebSocket ── room ────┼── listener laptop
 speaker PC ─┘   (star)      server    └── venue PA machine
                              │
                              └── R2 / local media (audio files, CDN)
```

Every device talks to the room server. Peers never talk to each other directly
today. The server is the only clock and the only writer of shared state, so there
is exactly one answer to "what is playing, where, and at what tempo".

### Why not peer-to-peer (WebRTC mesh)?

We looked at it; the server star wins for now:

| Concern | Server star (current) | P2P mesh |
| --- | --- | --- |
| Clock authority | One server clock, every device measures its offset to it | Needs leader election and re-election when the leader's tab sleeps |
| Conflicts | Server orders every command; a total order for free | Needs CRDTs or a leader to order commands |
| Late join / reconnect | Server holds snapshots | Must fetch state from a peer that may leave mid-set |
| NAT / venue Wi-Fi | Plain WebSocket over 443 | STUN/TURN, fails on locked-down venue networks |
| Fan-out | O(N) from server, cheap | O(N²) links in a mesh, phones can't sustain it |
| Latency between DJs in one room | RTT to server (tens of ms on a nearby VPS) | LAN RTT (a few ms) |

The one real P2P advantage is latency between devices on the same LAN. The plan
keeps the door open with a **LAN relay mode** (M5): the same room server binary run
on a laptop at the venue (`bun start` on the booth machine), which gives LAN RTTs
without changing the protocol. WebRTC data channels could later carry *ephemeral*
presence (below) between DJs, but never authoritative state.

## Sync classes

### 1. Clock (continuous, per device)

- **What:** each device's offset to server time and its round-trip time.
- **How:** coded NTP probe pairs (`apps/client/src/utils/ntp.ts`), min-RTT offset.
  Unchanged from Beatsync.
- **Per device, never shared:** output latency and manual nudge are local
  compensation; the server only learns the max, to size scheduling delays.

### 2. Deck timelines (scheduled snapshots)

- **What:** track loaded, play/pause, playhead, tempo, loops, cue point, hot cues.
- **Shape:** full `DeckState` snapshot per change with a timeline anchor
  `{ anchorServerTime, anchorPositionSec, pitchPercent }`. Position at any server
  time is `deckPositionAt()` in `packages/shared/dj/timeline.ts`, the same code on
  server and every client.
- **Timing:** transport changes anchor at `room.getScheduledExecutionTime()` (the
  Beatsync scheduling delay), so every device switches at the same moment.
  Quantized starts can push the anchor later, to the master deck's next beat.
- **Conflicts:** the server applies commands in arrival order; commands carry
  intent ("pause", "jump to hot cue 3"), never a client-computed playhead, so two
  DJs pressing buttons at once can't corrupt the timeline. Deck claims
  (`lockedBy`) stop accidental collisions; admins can override.
- **Ordering:** `version` increases per deck; clients ignore older snapshots.
- **Late join / reconnect:** `DJ_STATE` on join carries every deck; the device
  starts each playing deck at `deckPositionAt(now)`. If a reconnecting device's
  snapshot matches what it already plays, nothing restarts (continuity check).
- **Server restart:** decks are in the 60 s R2 backup. Clients keep playing their
  scheduled audio while the server is down, so the room keeps sounding.

### 3. Continuous controls (last-writer-wins, immediate)

- **What:** EQ, filter, trim, channel faders, crossfader and curve, master deck.
- **Shape:** partial `MixerPatch` in, full `MixerState` out (small, idempotent).
- **Timing:** applied on receipt with short gain ramps. Skew between devices is
  one network jitter (a few ms), which is inaudible for fader/EQ moves; scheduling
  them would add ~400 ms of lag under a DJ's fingers.
- **Conflicts:** last writer wins per field. The control under a DJ's finger keeps
  its local value while dragging and ignores echoes until release, so a slower
  echo never yanks the fader back.
- **Rate:** clients throttle drags to ~20 messages/s.

### 4. Collection + metadata (server-authoritative list)

- **What:** tracks in the room (`audioSources` with `meta`), their order, imports
  in progress.
- **Shape:** full list broadcast on change (`SET_AUDIO_SOURCES`), as in Beatsync.
- **Analysis sharing:** the first device to analyze a track reports its beat grid,
  key and duration (`DJ_TRACK_ANALYSIS`); the server keeps the first grid so
  SYNC/quantize use one grid everywhere. Later reports only fill gaps.
- **Removal:** removing a track ejects any deck holding it (broadcast).

### 5. Presence (ephemeral, lossy)

- **What:** who is connected, who is a DJ, who claimed which deck, who last
  touched a deck or the mixer (`lastActor`).
- **Today:** client list (`CLIENT_CHANGE`) and `lastActor` / `lockedBy` on
  snapshots.
- **Planned:** a `DJ_PRESENCE` channel for "Ria is touching the Deck B filter",
  sent at most 10/s, dropped freely, never persisted. This is the one class that
  could move to WebRTC data channels later without risk.

### 6. Per-device local state (never synced)

Headphone cue routing, manual nudge, output latency, UI layout, theme, waveform
zoom, library sort/filter. These stay in the browser (localStorage).

### 7. Audio assets (content-addressed, pulled)

Audio never goes through the WebSocket. Tracks live in R2 (or the local media
driver in dev) under `room-{roomId}/`, and every device downloads, decodes and
caches them itself. A deck snapshot only carries the URL; a device whose buffer
isn't ready yet starts the deck at the correct timeline position once it is.

## Reliability rules for live use

1. Nothing destructive on a playing deck (no load/eject while playing).
2. Commands are intents, positions are computed from the shared timeline.
3. A device that falls behind catches up from the timeline; it never asks
   others to wait (except Beatsync's party-mode first play, which waits ≤ 3 s).
4. Server downtime is silent for listeners: scheduled audio keeps playing.
5. Every refusal is told to the DJ (`DJ_NOTICE`) instead of being dropped.
