# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Beersync ([beersync.fm](https://beersync.fm)) is a multiplayer DJ console that runs in the browser: everyone in a **sesh** (a room) hears the same two-deck mix, in sync, on their own device. It is a rebuild of [Beatsync](https://github.com/freeman-jiang/beatsync), the open-source multi-device audio player — Beersync keeps Beatsync's sync engine (NTP-style clock sync, server-scheduled playback, the party/listening-party view at `/room/<id>/party`) and puts a rekordbox-style console on top of it. The npm package/workspace scope is still `@beatsync/shared`, and Docker/PM2 artifacts are still named `beatsync-*` (see Deployment).

Sesh vocabulary used throughout the code and docs:
- **Beer holder**: a DJ, i.e. someone allowed to touch the decks. The host always holds a beer; holders can pass a beer to someone else (or the host can take one back).
- **Listener**: everyone else — sees what's playing, reacts, and can hit **Ask for a beer** to request deck access.
- **Open bar**: a host toggle that lets everyone use the decks (equivalent to Beatsync's "everyone" playback permission).

Turborepo monorepo with three packages:

- **`apps/client`**: Next.js (App Router, React 19, Tailwind v4, Shadcn/ui) — see `apps/client/package.json` for the pinned Next version
- **`apps/server`**: Bun HTTP + WebSocket server (native `Bun.serve`, not Hono routing, despite `hono` being a dependency)
- **`packages/shared`**: Zod schemas + shared deck/mixer math across client/server (`@beatsync/shared`), including `dj/timeline.ts`, `dj/mixer.ts`, `dj/keys.ts`

## Commands

```bash
bun install                       # Install all dependencies (run from root)
bun dev                           # Start both client and server in dev mode (Turborepo)
bun run dev --filter=client       # Dev-mode client only (port 3000)
bun run dev --filter=server       # Dev-mode server only (port 8080)
bun build                         # Build all packages
bun client                        # PRODUCTION build+start for client only (`turbo start --filter=client`, which builds first; no hot reload)
bun server                        # PRODUCTION build+start for server only (`turbo start --filter=server`, which builds first; no hot reload)

bun run test             # Run all test suites via Turborepo (do NOT use bare `bun test` at root — per-app bunfig preloads won't load)

# Server-specific (run from apps/server/)
bun test                 # Run tests (Bun test runner)
bun test --watch         # Watch mode
bun run cleanup          # Dry-run orphaned R2 room cleanup
bun run cleanup:live     # Delete orphaned R2 rooms
bun run typecheck        # tsc --noEmit (alias: type-check)

# Client-specific (run from apps/client/)
bun test                 # Run tests (happy-dom + @testing-library/react, preloaded via bunfig.toml)
bun run lint             # eslint src/
bun run typecheck        # tsc --noEmit
```

## Architecture

### Server Manager Hierarchy

The server uses a manager pattern with in-memory state (no database):

- **`GlobalManager`** (singleton): Manages all rooms. Accessed via `GlobalManager.rooms`. Caches active user count with dirty flag.
- **`RoomManager`** (per-room): Owns clients, audio sources, playback state, spatial audio config, chat, and a `DeckManager` (`room.getDj()`). Handles audio loading coordination, synchronized play scheduling, and sesh roles: `canDj()` (admin, beer holder, or open bar), `passBeer()` / `setWantsBeer()`.
- **`DeckManager`** (per-room, owned by `RoomManager`): Owns the two decks (A/B) and the mixer — the DJ console's shared state. `applyCommand()` takes a `DeckCommand` + actor and returns the new `DeckState` (and `MixerState` when a command also patches the mixer). See "DJ console" below and [SYNC_MODEL.md](./SYNC_MODEL.md).
- **`ChatManager`** (per-room, owned by RoomManager): Message history with incremental IDs.
- **`BackupManager`** (singleton): Periodic state backup/restore to R2 (every 60s, only when R2 is configured). Restores on startup.
- **`MusicProviderManager`**: External music search and streaming integration (Beatsync's original provider; see "Music sources" below).

### WebSocket Protocol

All WebSocket messages are validated with Zod discriminated unions. The flow:

1. Client connects → `handleOpen()` subscribes to room topic, sends initial room state
2. Incoming messages validated against `WSRequestSchema` → dispatched via `WebsocketRegistry` (type-safe handler map in `apps/server/src/websocket/registry.ts`)
3. Each handler is a separate file in `apps/server/src/websocket/handlers/`
4. Server responses are three categories defined in `packages/shared/types/`:
   - **`WSBroadcast`**: Sent to all room clients (room events, scheduled actions, stream updates)
   - **`WSUnicast`**: Sent to a single client (NTP responses, search results)
   - **`WSResponse`**: Union of broadcast + unicast

Adding a new WebSocket message type requires: adding to `ClientActionEnum` in `packages/shared/types/WSRequest.ts`, creating a schema, adding a handler file, and registering it in the registry.

The client mirrors this pattern for server→client messages: an exhaustive registry over `ServerActionEnum` in `apps/client/src/websocket/registry.ts`, dispatched from `WebSocketManager`'s `onmessage`. Adding a server→client message type requires registering it there too.

### Time Synchronization

NTP-inspired protocol for millisecond-accurate cross-device playback:
- Client sends `NTP_REQUEST` with `t0` → server stamps `t1`/`t2` → client receives at `t3`
- Exponential moving average smoothing (α=0.2) for RTT estimation
- Minimum 10 measurements before "synced" state
- Play/pause commands are **scheduled actions**: server broadcasts `serverTimeToExecute` and clients execute at that synchronized moment, using max client RTT to calculate delay

### DJ Console (Decks + Mixer)

Beersync's core addition over Beatsync. Full details and the sync-class rationale live in [SYNC_MODEL.md](./SYNC_MODEL.md); summary:

- **Deck state** (`DeckStateSchema` in `packages/shared/types/dj.ts`) is a full snapshot per deck with a **timeline anchor**: `{ anchorServerTime, anchorPositionSec, pitchPercent, ... }`. Every device computes the current playhead with the same pure function, `deckPositionAt()` in `packages/shared/dj/timeline.ts` — position(t) = `anchorPositionSec + (t - anchorServerTime) / 1000 * rate`.
- **Transport changes** (play, pause, cue, seek, loops, tempo, sync, hot cues) are *scheduled*: the server computes a new anchor at `room.getScheduledExecutionTime()` (same delay mechanism Beatsync uses for play/pause) so every device switches at once. Quantized starts can push the anchor to the master deck's next beat.
- **Mixer changes** (EQ, filter, trim, faders, crossfader) apply immediately on receipt as a `MixerPatch` — no scheduling, since skew is inaudible for continuous controls and scheduling would add lag under a DJ's fingers.
- **Adding a new deck command**: add a variant to `DeckCommandSchema` in `packages/shared/types/dj.ts`, add a `case` in `DeckManager.applyCommand()`'s switch (`apps/server/src/managers/DeckManager.ts`), and send it from the client via `useDjStore().sendDeckCommand(deckId, command)` (`apps/client/src/store/dj.tsx`), which wraps `DJ_DECK_COMMAND` — no separate registry entry needed since deck commands share one WS message type. A brand-new *DJ* WebSocket message type (not a deck command) follows the normal WS Protocol steps above; existing ones include `DJ_DECK_COMMAND`, `DJ_CLAIM_DECK`, `DJ_MIXER_UPDATE`, `DJ_IMPORT_TRACK`, `DJ_TRACK_ANALYSIS`, plus the sesh-role messages `PASS_BEER`, `REQUEST_BEER`, `SEND_REACTION` (handlers in `apps/server/src/websocket/handlers/`).
- **Deck claims** (`lockedBy`): a DJ can claim a deck so only they (or an admin) can operate it.
- **Track analysis**: runs client-side in a browser worker (`apps/client/src/lib/dj/analysis/`) — BPM, beat grid, Camelot key, waveform colour bands. The first device to analyze a track reports its beat grid via `DJ_TRACK_ANALYSIS`; the server keeps the first grid so SYNC/quantize agree everywhere.

### Music Sources & Storage

- **Sources** (`apps/server/src/sources/`): server-side adapters — `audius.ts`, `jamendo.ts`, `provider.ts` (Beatsync's original provider), `url.ts` (direct link import), plus shared plumbing (`ingest.ts`, `safeFetch.ts` for SSRF protection + size caps, `trackMeta.ts`, `musicalKey.ts`). Enabled sources are listed at `GET /library/sources`; search/browse via `/library/search` and `/library/browse`. Loading a track from a source downloads it server-side into the sesh's storage and adds it to the room collection.
- **Storage driver** (`apps/server/src/storage/`): `index.ts` picks R2 (`r2.ts`) or local disk (`local.ts` + `localHttp.ts`) depending on whether all five `S3_*` env vars are set. Local mode serves files itself from `/media/...` under `LOCAL_MEDIA_DIR` (default `.data/media` inside `apps/server`), using `PUBLIC_SERVER_URL` for links. `keys.ts`/`stream.ts` hold key construction and streaming helpers common to both drivers.

### Audio Pipeline

Three-step upload flow (client uploads directly to R2, no server bandwidth used, when R2 is configured):
1. `POST /upload/get-presigned-url` → server generates presigned R2 PUT URL
2. Client PUTs file directly to R2
3. `POST /upload/complete` → server adds to room's audio sources, broadcasts update

Without R2 configured, uploads go through the local storage driver instead (see "Music Sources & Storage").

R2 key structure: `room-{roomId}/{sanitized-name}{delimiter}{timestamp}.{ext}`, where the delimiter is `R2_AUDIO_FILE_NAME_DELIMITER` (`"___"`) in `packages/shared/constants.ts`.

Utilities: `apps/server/src/lib/r2.ts` (presigned URLs, public URLs, batch delete, orphan cleanup), `apps/server/src/utils/responses.ts` (CORS headers, error/success response helpers).

### Client Console, Engine & MIDI

- **`apps/client/src/components/console/`**: the DJ console UI — `Console.tsx`, `Deck.tsx`, `Mixer.tsx`, `Library.tsx`, `WaveformView.tsx`, `ListenerView.tsx` (the non-DJ view: now playing, mix levels, reactions, "Ask for a beer"), `SeshMinimap.tsx` (who's in the sesh / holds a beer), `ConsoleTopBar.tsx`, `ControllerButton.tsx` (MIDI connect), plus `useDeckShortcuts.ts` for the keyboard shortcuts.
- **`apps/client/src/components/neu/`**: the neumorphic control kit (`Knob`, `Fader`, `JogWheel`, `PadGrid`, `LedMeter`, `LcdDisplay`, `NeuButton`, `NeuToggle`, `NeuPanel`) shared by decks and mixer.
- **`apps/client/src/lib/dj/`**: the audio engine — `engine.ts` (playback via Web Audio, driven by deck timelines), `clock.ts` (`serverNow()`, NTP-adjusted time), `buffers.ts` (LRU-cached decoded audio buffers), `analysis/` (the BPM/key/waveform worker).
- **`apps/client/src/lib/midi/`**: Pioneer DDJ-FLX4 support over Web MIDI — `controller.ts` (connect/reconnect), `flx4.ts` (control mapping), `browse.ts` (library browse via the controller's browse knob).

### Client State Management

Zustand stores in `apps/client/src/store/`:
- **`global.tsx`**: Main store. Audio sources, WebSocket connection, NTP sync state, spatial audio, playback state, volume, search results, stream jobs. Uses LRU buffer cache (max 3 audio buffers).
- **`room.tsx`**: Room metadata (roomId, username, loading state)
- **`chat.tsx`**: Chat messages
- **`dj.tsx`**: DJ console state — decks (`DeckState` per deck plus the previous snapshot until its anchor time passes), mixer, per-track runtime status (loading/ready/error + analysis), and `sendDeckCommand()` / mixer and claim senders.
- **`sesh.tsx`**: The social layer — live reactions, `passBeer()`, `requestBeer()`, `setOpenBar()`.

HTTP data fetching uses Axios + TanStack React Query. WebSocket message utilities in `apps/client/src/utils/ws.ts`.

### Audio Loading Coordination

When play is requested, the server doesn't immediately schedule playback. Instead:
1. Server broadcasts `LOAD_AUDIO_SOURCE` to all clients
2. Clients load/decode the audio and respond with `AUDIO_SOURCE_LOADED`
3. Server waits for all clients (or 3s timeout) then schedules synchronized play

### Spatial Audio

Grid-based positioning system where clients are placed on a grid. A "listening source" position determines gain per client using distance calculations. Server broadcasts spatial gain config at 100ms intervals. Client applies: `effectiveGain = globalVolume × spatialGain`.

## Environment Setup

R2 is optional for local dev. Without the `S3_*` vars set, the server stores uploads and imported tracks under `apps/server/.data/media` and serves them itself from `/media/...`; periodic state backups only run when R2 is configured.

`apps/client/.env`:
```
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws
```

`apps/server/.env` (all optional in dev — see README.md "Configuration" for the full list, including source/provider toggles and Beatsync demo mode):
```
S3_BUCKET_NAME=
S3_PUBLIC_URL=
S3_ENDPOINT=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
LOCAL_MEDIA_DIR=          # local media storage dir; default .data/media (used when S3_* are unset)
PUBLIC_SERVER_URL=        # public base URL of this server, used for local media links; default http://localhost:8080
```

## Deployment

- **Docker**: Multi-stage build with `oven/bun:1`. Exposes port 8080. Entry: `bun start`.
- **PM2**: Config in `pm2.config.js`. Process name: `beatsync-server`.
- Server has graceful shutdown (SIGTERM/SIGINT) that backs up state to R2 before exit.

## Agent Communication

- All agents working in this repo (main session and every subagent) use the `caveman` skill (`.claude/skills/caveman`, installed via `npx skills add https://github.com/juliusbrussee/caveman --skill caveman`) for chat replies and reports: terse, no filler, full technical accuracy.
- Code, code comments, commit messages, PR text, and docs (README, SYNC_MODEL.md, CLAUDE.md) stay in normal prose, as the skill's own boundaries require.

## Development Notes

- Both apps use `bun test`: server with sinon fake timers for stubs, client with happy-dom + `@testing-library/react` (preloads in `apps/client/bunfig.toml`)
- Only test non-obvious behavior whose failure would be silent in dev and expensive in prod — no trivial/"doesn't crash" tests
- Server uses native `Bun.serve()` with URL pathname switch routing (not Hono's router)
- Room IDs are 6-digit codes
- Room cleanup: 60s after last client disconnects, room is deleted (including its R2 uploads — intentional)
- Admin auto-promotion: if last admin leaves, the most recently seen client is promoted
- Client liveness: server sends `LIVENESS_PING` after 15s of silence; clients reply `LIVENESS_PONG` from `onmessage` (immune to background-tab timer throttling); silent for 60s → terminated and removed
