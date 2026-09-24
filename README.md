# Beersync

**[beersync.fm](https://beersync.fm)** (launching when the product is ready)

Beersync is a multiplayer DJ console that runs in the browser. Everyone in a **sesh** hears the same mix, in sync, on their own device. The people holding a **beer** run the decks together; everyone else listens along, reacts, and can ask for a beer to jump on.

It is a rebuild of [Beatsync](https://github.com/freeman-jiang/beatsync) ([beatsync.gg](https://www.beatsync.gg/)), the open-source multi-device audio player. Beersync keeps Beatsync's sync engine (NTP-style clock sync and server-scheduled playback) and puts a two-deck, rekordbox-style console with a neumorphic look on top of it.

> Beersync is in early development. The console has only been verified with automated tests so far; expect rough edges on real devices.

## What you can do today

**Decks** (two, A and B)
- Play / pause, CDJ-style CUE, seek from the track overview, jog-wheel nudges
- 8 hot cues per deck, auto loops (1–16 beats), halve / double / exit, beat jump
- Tempo fader with ±6 / 10 / 16 / 50 % ranges
- SYNC (matches tempo and beat phase to the master deck, including half/double time), MASTER, QUANTIZE
- Claim a deck so only you (or the host) can operate it

**Mixer**
- Per channel: trim, 3-band EQ with kill, a bipolar low-pass / high-pass filter, channel fader, LED meter
- Crossfader with A / THRU / B assign and a smooth or sharp curve; master volume

**Track analysis** (runs in a browser worker)
- BPM and beat grid, musical key in Camelot notation, rekordbox-style 3-band colour waveforms
- The first device to analyze a track shares its beat grid, so SYNC and quantize use the same grid everywhere
- Harmonic matches are highlighted in the library

**Library**
- The sesh's own collection: upload files, then load them to deck A or B
- Online sources with search and genre charts: Audius, Jamendo, a direct link importer, and Beatsync's original music provider (see [Music sources](#music-sources))
- Imported tracks are stored per sesh, the way Beatsync stores uploads

**The sesh**
- The host always holds a beer. Beer holders can pass beers to others; the host can take one back; holders can put theirs down
- "Open bar" mode (host toggle) lets everyone use the decks
- Listeners get their own view: what's playing and how loud each deck is in the mix, live waveforms, emoji reactions, and an **Ask for a beer** button
- A minimap in the corner shows who's in the sesh, who holds a beer and who wants one, and pulses on the beat
- Reactions float up everyone's screen, DJs included
- Beatsync's listening-party view (queue player, spatial audio, chat) still lives at `/room/<id>/party`
- Dark and light neumorphic themes

**Keyboard shortcuts** (beer holders; press `?` in the console to see them)

| | Deck A | Deck B |
| --- | --- | --- |
| Cue | `Q` | `I` |
| Play / pause | `W` | `O` |
| Sync | `E` | `P` |
| Hot cues 1–4 | `1` `2` `3` `4` | `7` `8` `9` `0` |
| 4-beat loop on / off | `S` | `L` |

Crossfader: `[` and `]` move it, `\` centres it.

### Pioneer DDJ-FLX4

Beer holders can play the decks from a Pioneer DDJ-FLX4 over USB. It uses Web MIDI, so it needs Chrome or Edge (desktop or Android). Click **Connect controller** in the console's top bar; the controller reconnects automatically if you unplug it.

| On the FLX4 | In Beersync |
| --- | --- |
| PLAY/PAUSE, CUE, SHIFT + CUE | Play/pause, CDJ cue, back to the start |
| BEAT SYNC, long press, SHIFT + BEAT SYNC | Sync, set as master, change tempo range |
| Tempo faders | Tempo (takes over once the fader reaches the deck's current tempo) |
| Jog wheels | Nudge while playing, move the playhead while paused, SHIFT for fast search |
| Pads: HOT CUE / BEAT JUMP / BEAT LOOP modes | Hot cues (SHIFT deletes), beat jumps of 1–8 beats, loops of 1/4–32 beats |
| LOOP IN, RELOOP/EXIT, CUE/LOOP CALL ◀ ▶ | 4-beat loop, loop on/off, halve/double; SHIFT + CUE/LOOP CALL jumps 16 beats |
| Trim, EQ, CFX filter, channel faders, crossfader | The Beersync mixer |
| Browse knob, LOAD | Move the library selection, load it to deck A or B |

The play, cue, loop and hot cue LEDs and the level meters follow the shared decks, so they stay right when another DJ presses something. If the tempo fader runs the wrong way on your unit, turn on **Reverse tempo fader** in the controller menu. Headphone cue, Beat FX and sampler pads aren't supported yet.

## How the sync works

Every device measures its clock offset to the sesh server, as in Beatsync. Each deck is shared as a snapshot with a timeline anchor ("at server time T the playhead is at P, moving at rate R"), and every device computes the playhead with the same function, so they all agree on where each deck is. Transport changes (play, pause, cues, loops, tempo, sync) are scheduled for a moment slightly in the future so every device switches at once. Mixer moves apply as soon as they arrive.

[SYNC_MODEL.md](./SYNC_MODEL.md) explains which kind of sync every piece of state uses and why the server stays in the middle instead of devices talking peer to peer.

## Quickstart

You need [Bun](https://bun.sh/) (the repo pins its version in `mise.toml`).

```sh
bun install
```

Create `apps/client/.env`:

```sh
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws
```

Then start both apps:

```sh
bun dev    # client on http://localhost:3000, server on http://localhost:8080
```

Open http://localhost:3000, start a new sesh, and share the link or code. Click the start button once the clock sync finishes; browsers only play audio after a click.

You don't need Cloudflare R2 to develop. Without the `S3_*` variables the server stores uploads and imported tracks in `apps/server/.data/media` and serves them itself from `/media/…`. Periodic state backups only run when R2 is configured.

## Configuration

**Server** (`apps/server/.env`)

| Variable | Purpose | Default |
| --- | --- | --- |
| `S3_BUCKET_NAME`, `S3_PUBLIC_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Cloudflare R2 (or any S3-compatible store) for audio and state backups. All five must be set to use R2. | unset: local media storage |
| `LOCAL_MEDIA_DIR` | Where local media storage keeps files | `.data/media` (inside `apps/server`) |
| `PUBLIC_SERVER_URL` | Public base URL of this server, used for local media links | `http://localhost:8080` |
| `LOCAL_UPLOAD_SECRET` | Signs local upload URLs | random per process |
| `AUDIUS_API_URL`, `AUDIUS_APP_NAME`, `AUDIUS_DISABLED` | Audius source settings (`AUDIUS_DISABLED=1` turns it off) | `https://api.audius.co/v1`, `beersync`, enabled |
| `JAMENDO_CLIENT_ID`, `JAMENDO_API_URL` | Enables the Jamendo source | Jamendo off |
| `PROVIDER_URL` | Beatsync's music provider service (search + stream) | off |
| `CREATOR_SECRET` | Beatsync's creator flag: the client that connects with it is renamed `freemanjiang` and gets a Creator badge in the party view | unset |
| `DEMO`, `DEMO_AUDIO_DIR`, `DEMO_ADMIN_SECRET` | Beatsync's offline demo mode | off |

**Client** (`apps/client/.env`)

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` | Server HTTP and WebSocket URLs. Set both or neither; if either is missing the client uses its own origin for both (`/ws` for the socket), which suits a reverse proxy serving client and server together. |
| `NEXT_PUBLIC_POSTHOG_KEY` | Optional analytics |
| `NEXT_PUBLIC_DEMO_MODE` | Beatsync demo mode |

## Music sources

Sources are server-side adapters in `apps/server/src/sources/`. The client lists the enabled ones from `GET /library/sources`, then uses `/library/search` and `/library/browse`. When a DJ loads a track from a source, the server downloads it (with SSRF protection and a size cap) into the sesh's storage and adds it to the collection.

| Source | Enabled when | What it offers |
| --- | --- | --- |
| `audius` | always, unless `AUDIUS_DISABLED=1` | Search and trending charts by genre |
| `jamendo` | `JAMENDO_CLIENT_ID` is set | Creative Commons catalogue, search and genre charts |
| `provider` | `PROVIDER_URL` is set | Beatsync's original music provider |
| `url` | always | Paste a link to an audio file |

Check each catalogue's terms before using its tracks in public shows.

## Project layout

| Path | What's there |
| --- | --- |
| `apps/client` | Next.js app. `src/components/console` is the DJ console, `src/components/neu` the neumorphic control kit, `src/lib/dj` the audio engine and track analysis, `src/store/dj.tsx` and `src/store/sesh.tsx` the console state |
| `apps/server` | Bun HTTP + WebSocket server. `src/managers/DeckManager.ts` owns each sesh's decks and mixer, `src/sources` the music sources, `src/storage` R2 / local storage |
| `packages/shared` | Zod schemas and the shared deck maths (`dj/timeline.ts`, `dj/mixer.ts`, `dj/keys.ts`) used by both apps |

## Development

```sh
bun run test        # all test suites through Turborepo (don't run bare `bun test` at the repo root)
bun client          # build + start client only (production, no hot reload)
bun server          # build + start server only (production, no hot reload)
bun run dev --filter=client   # client dev server (hot reload)
bun run dev --filter=server   # server dev (or: cd apps/server && bun dev)

cd apps/server && bun test && bun run typecheck && bun run lint
cd apps/client && bun test && bun run typecheck && bun run lint
```

The control kit has a showcase page at http://localhost:3000/neu for checking knobs, faders, the jog wheel and meters by hand.

A pre-commit hook (lefthook) formats, lints and type-checks staged files.

## Deploying

Beersync deploys the way Beatsync does:

- **Server:** the `Dockerfile` builds and runs the Bun server on port 8080 (`bun run docker:prod`, which needs `apps/server/.env` to exist — it can be empty, or hold just `PUBLIC_SERVER_URL` — since `docker run` is passed `--env-file apps/server/.env`), or use PM2 with `pm2.config.js` after `bun run build` (its interpreter expects `bun` from mise shims at `~/.local/share/mise/shims/bun`, so mise needs to be installed there, or swap the interpreter for plain `bun`). Graceful shutdown backs up state to R2 when R2 is configured.
- **Client:** any Next.js host; `vercel.json` is set up for Vercel.
- **Same origin:** to serve both from one domain, put a reverse proxy in front that forwards `/ws` (with WebSocket upgrade) plus the server's HTTP paths (`/upload/`, `/library/`, `/media/`, `/media-upload/`, `/active-rooms`, `/discover`, `/stats`, `/default`, `/health`), and leave the `NEXT_PUBLIC_*` URLs unset. Without R2, also set `PUBLIC_SERVER_URL` to the proxy's public origin, or the local media links the server hands out will point at `http://localhost:8080`.

## Roadmap

Not built yet:

- Key lock (master tempo), headphone cue / pre-listen, beat FX, mix recording
- Four decks, more MIDI controllers, slip mode, beat grid editing
- Crates, playlists and history; accounts
- Hand-off tools for B2B sets, listener track requests, sesh recaps
- Drift monitoring and a venue ("booth") relay mode for live shows

## Credits and license

Built on [Beatsync](https://github.com/freeman-jiang/beatsync) by Freeman Jiang and contributors. MIT licensed; see [LICENSE](./LICENSE).
