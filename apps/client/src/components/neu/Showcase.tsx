"use client";

import { Headphones, Moon, Pause, Play, Sun } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Fader } from "./Fader";
import { JogWheel, type JogWheelHandle } from "./JogWheel";
import { Knob } from "./Knob";
import { LcdDisplay } from "./LcdDisplay";
import { LedMeter, type LedMeterHandle } from "./LedMeter";
import { NeuButton } from "./NeuButton";
import { NeuPanel } from "./NeuPanel";
import { NeuToggle } from "./NeuToggle";
import { PadGrid, type Pad } from "./PadGrid";

/*
 * Visual QA page for the neumorphic console kit: a mini two-deck mixer driven
 * by a fake rAF signal. Every continuous control is wired through a simulated
 * server echo (configurable lag) so the drag/echo guard can be felt by hand.
 */

type DeckId = "a" | "b";

const TRACK_LEN = 319.4;
const BASE_BPM: Record<DeckId, number> = { a: 124, b: 126.5 };
const PAD_COLORS = ["#ff5a5a", "#f3a53d", "#f5d142", "#3ddc84", "#3ccbe2", "#6f8cff", "#b57aff", "#ff6fb5"];
/** 33⅓ rpm in degrees per second. */
const PLATTER_DEG_PER_SEC = (100 / 3 / 60) * 360;

const fmtDb = (v: number) => (v <= -25.9 ? "KILL" : `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`);
const fmtTrim = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
const fmtFilter = (v: number) =>
  Math.abs(v) < 0.005 ? "OFF" : v < 0 ? `LPF ${Math.round(-v * 100)}%` : `HPF ${Math.round(v * 100)}%`;
const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtPitch = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(2)}%`;
const fmtX = (v: number) =>
  Math.abs(v) < 0.005 ? "CENTER" : v < 0 ? `A ${Math.round(-v * 100)}` : `B ${Math.round(v * 100)}`;

function fmtTime(sec: number) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, "0")}:${r.toFixed(1).padStart(4, "0")}`;
}

/** State that only updates after a fake network round-trip, like room state. */
function useEchoed(initial: number, lagRef: RefObject<number>) {
  const [value, setValue] = useState(initial);
  const send = (v: number) => {
    const lag = lagRef.current;
    if (lag <= 0) setValue(v);
    else setTimeout(() => setValue(v), lag + Math.random() * lag * 0.5);
  };
  return [value, send] as const;
}

interface ChannelState {
  trim: number;
  hi: number;
  mid: number;
  low: number;
  filter: number;
  fader: number;
}

function useChannel(lagRef: RefObject<number>, fader: number) {
  const [trim, setTrim] = useEchoed(0, lagRef);
  const [hi, setHi] = useEchoed(0, lagRef);
  const [mid, setMid] = useEchoed(0, lagRef);
  const [low, setLow] = useEchoed(0, lagRef);
  const [filter, setFilter] = useEchoed(0, lagRef);
  const [faderV, setFader] = useEchoed(fader, lagRef);
  const [cue, setCue] = useState(false);
  return {
    state: { trim, hi, mid, low, filter, fader: faderV } satisfies ChannelState,
    set: { trim: setTrim, hi: setHi, mid: setMid, low: setLow, filter: setFilter, fader: setFader },
    cue,
    setCue,
  };
}

interface DeckState {
  playing: boolean;
  pitch: number;
  vinyl: boolean;
}

export function Showcase() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [lagOn, setLagOn] = useState(true);
  const lagRef = useRef(150);
  useEffect(() => {
    lagRef.current = lagOn ? 150 : 0;
  }, [lagOn]);

  const chA = useChannel(lagRef, 0.8);
  const chB = useChannel(lagRef, 0.65);
  const [xfade, setXfade] = useEchoed(0, lagRef);
  const [master, setMaster] = useEchoed(0.8, lagRef);

  const [playing, setPlaying] = useState<Record<DeckId, boolean>>({ a: true, b: false });
  const [pitchA, setPitchA] = useEchoed(0, lagRef);
  const [pitchB, setPitchB] = useEchoed(1.2, lagRef);
  const [vinyl, setVinyl] = useState<Record<DeckId, boolean>>({ a: true, b: false });
  const [times, setTimes] = useState<Record<DeckId, number>>({ a: 42, b: 0 });

  // --- fake real-time signal -------------------------------------------------
  const jogA = useRef<JogWheelHandle>(null);
  const jogB = useRef<JogWheelHandle>(null);
  const meterA = useRef<LedMeterHandle>(null);
  const meterB = useRef<LedMeterHandle>(null);
  const meterL = useRef<LedMeterHandle>(null);
  const meterR = useRef<LedMeterHandle>(null);
  const posRef = useRef<Record<DeckId, number>>({ a: 42, b: 0 });
  const holdRef = useRef<Record<DeckId, boolean>>({ a: false, b: false });
  const liveRef = useRef({
    decks: { a: { playing: true, pitch: 0, vinyl: true }, b: { playing: false, pitch: 1.2, vinyl: false } } as Record<
      DeckId,
      DeckState
    >,
    ch: { a: chA.state, b: chB.state },
    xfade: 0,
    master: 0.8,
  });
  useEffect(() => {
    liveRef.current = {
      decks: {
        a: { playing: playing.a, pitch: pitchA, vinyl: vinyl.a },
        b: { playing: playing.b, pitch: pitchB, vinyl: vinyl.b },
      },
      ch: { a: chA.state, b: chB.state },
      xfade,
      master,
    };
  });

  useEffect(() => {
    const jogs = { a: jogA, b: jogB };
    const meters = { a: meterA, b: meterB };
    let raf = 0;
    let last = performance.now();
    const env = { a: 0, b: 0 };
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const live = liveRef.current;
      const out: Record<DeckId, number> = { a: 0, b: 0 };
      for (const id of ["a", "b"] as const) {
        const deck = live.decks[id];
        const rate = 1 + deck.pitch / 100;
        const running = deck.playing && !holdRef.current[id];
        if (running) posRef.current[id] = (posRef.current[id] + dt * rate) % TRACK_LEN;
        const pos = posRef.current[id];
        jogs[id].current?.setAngle((pos * PLATTER_DEG_PER_SEC) % 360);

        const ch = live.ch[id];
        const beat = 60 / (BASE_BPM[id] * rate);
        const phase = (pos % beat) / beat;
        const kick = Math.exp(-phase * 7) * (0.7 + 0.3 * ((ch.low + 26) / 32));
        const body = 0.35 + 0.12 * Math.sin(pos * 13.1) + 0.08 * Math.sin(pos * 47.3);
        const target = running ? Math.min(1.05, (kick * 0.55 + body) * 10 ** (ch.trim / 40)) : 0;
        env[id] += (target - env[id]) * (target > env[id] ? 0.6 : 0.12);
        const post = env[id] * ch.fader;
        meters[id].current?.setLevel(post);
        const xGain = id === "a" ? Math.min(1, 1 - live.xfade) : Math.min(1, 1 + live.xfade);
        out[id] = post * xGain;
      }
      const sum = Math.min(1, (out.a + out.b) * live.master * 0.85);
      meterL.current?.setLevel(sum);
      meterR.current?.setLevel(Math.max(0, sum - 0.03 * Math.sin(now / 90)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const interval = setInterval(() => setTimes({ ...posRef.current }), 100);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(interval);
    };
  }, []);

  const nudge = (id: DeckId, sec: number) => {
    posRef.current[id] = Math.max(0, posRef.current[id] + sec);
  };

  return (
    <div className="neu min-h-dvh w-full" data-theme={theme}>
      <div className="mx-auto flex max-w-[1360px] flex-col gap-5 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-bold tracking-[0.3em]" style={{ color: "var(--neu-text)" }}>
              BEERSYNC
            </p>
            <p className="text-xs" style={{ color: "var(--neu-muted)" }}>
              Console kit · visual QA
            </p>
          </div>
          <div className="flex items-center gap-3">
            <NeuToggle
              label="Echo lag 150ms"
              checked={lagOn}
              onCheckedChange={setLagOn}
              ledColor="var(--neu-warn)"
              title="Route every control through a fake server round-trip"
            />
            <NeuButton
              variant="ghost"
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            >
              {theme === "dark" ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
            </NeuButton>
          </div>
        </header>

        <main className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Deck
            id="a"
            color="var(--deck-a)"
            jogRef={jogA}
            time={times.a}
            playing={playing.a}
            onPlay={() => setPlaying((p) => ({ ...p, a: !p.a }))}
            onCue={() => {
              posRef.current.a = 32;
              setPlaying((p) => ({ ...p, a: false }));
            }}
            pitch={pitchA}
            onPitch={setPitchA}
            vinyl={vinyl.a}
            onVinyl={(v) => setVinyl((s) => ({ ...s, a: v }))}
            onNudge={(s) => nudge("a", s)}
            onTouch={(t) => (holdRef.current.a = t)}
          />

          <NeuPanel className="flex flex-col items-center gap-4 p-4">
            <div className="flex items-start gap-3 sm:gap-5">
              <ChannelStrip name="A" color="var(--deck-a)" ch={chA} meterRef={meterA} />
              <div className="flex flex-col items-center gap-3 pt-1">
                <span className="neu-label">Master</span>
                <div className="flex gap-1.5">
                  <LedMeter ref={meterL} height={150} width={8} />
                  <LedMeter ref={meterR} height={150} width={8} />
                </div>
                <Knob
                  label="Level"
                  value={master}
                  onChange={setMaster}
                  defaultValue={0.8}
                  size={48}
                  color="var(--neu-text)"
                  format={fmtPct}
                />
                <LcdDisplay label="Xfade" value={fmtX(xfade)} size="sm" className="w-[84px]" />
              </div>
              <ChannelStrip name="B" color="var(--deck-b)" ch={chB} meterRef={meterB} />
            </div>
            <Fader
              orientation="horizontal"
              label="Crossfader"
              value={xfade}
              min={-1}
              max={1}
              centerDetent
              ticks={9}
              length={240}
              color="var(--neu-text)"
              format={fmtX}
              onChange={setXfade}
            />
          </NeuPanel>

          <Deck
            id="b"
            color="var(--deck-b)"
            jogRef={jogB}
            time={times.b}
            playing={playing.b}
            onPlay={() => setPlaying((p) => ({ ...p, b: !p.b }))}
            onCue={() => {
              posRef.current.b = 0;
              setPlaying((p) => ({ ...p, b: false }));
            }}
            pitch={pitchB}
            onPitch={setPitchB}
            vinyl={vinyl.b}
            onVinyl={(v) => setVinyl((s) => ({ ...s, b: v }))}
            onNudge={(s) => nudge("b", s)}
            onTouch={(t) => (holdRef.current.b = t)}
          />
        </main>

        <footer className="text-xs" style={{ color: "var(--neu-muted)" }}>
          Drag knobs vertically (Shift = fine), double-click / double-tap to reset. Faders never jump when grabbing the
          track. Shift+click or long-press a set pad to clear it.
        </footer>
      </div>
    </div>
  );
}

function ChannelStrip({
  name,
  color,
  ch,
  meterRef,
}: {
  name: string;
  color: string;
  ch: ReturnType<typeof useChannel>;
  meterRef: RefObject<LedMeterHandle | null>;
}) {
  const { state, set } = ch;
  return (
    <div className="flex flex-col items-center gap-2" role="group" aria-label={`Channel ${name}`}>
      <Knob
        label="Trim"
        value={state.trim}
        min={-12}
        max={12}
        step={0.1}
        defaultValue={0}
        size={44}
        color={color}
        format={fmtTrim}
        onChange={set.trim}
      />
      <Knob label="Hi" value={state.hi} {...eq} color={color} onChange={set.hi} />
      <Knob label="Mid" value={state.mid} {...eq} color={color} onChange={set.mid} />
      <Knob label="Low" value={state.low} {...eq} color={color} onChange={set.low} />
      <Knob
        label="Filter"
        value={state.filter}
        min={-1}
        max={1}
        step={0.01}
        bipolar
        size={44}
        color={color}
        format={fmtFilter}
        onChange={set.filter}
      />
      <NeuButton
        size="sm"
        active={ch.cue}
        ledColor={color}
        aria-label={`Headphone cue ${name}`}
        onClick={() => ch.setCue(!ch.cue)}
      >
        <Headphones size={16} aria-hidden />
      </NeuButton>
      <div className="flex items-end gap-2">
        <LedMeter ref={meterRef} height={170} width={8} />
        <Fader
          label={name}
          aria-label={`Channel ${name} fader`}
          value={state.fader}
          ticks={11}
          length={170}
          color={color}
          format={fmtPct}
          onChange={set.fader}
        />
      </div>
    </div>
  );
}

const eq = { min: -26, max: 6, step: 0.1, defaultValue: 0, bipolar: true, size: 44, format: fmtDb } as const;

const INITIAL_PADS: Pad[] = [
  { color: PAD_COLORS[0], label: "Intro" },
  { color: PAD_COLORS[1], label: "Drop" },
  null,
  { color: PAD_COLORS[3], label: "Break" },
  null,
  null,
  { color: PAD_COLORS[6] },
  null,
];

function Deck({
  id,
  color,
  jogRef,
  time,
  playing,
  onPlay,
  onCue,
  pitch,
  onPitch,
  vinyl,
  onVinyl,
  onNudge,
  onTouch,
}: {
  id: DeckId;
  color: string;
  jogRef: RefObject<JogWheelHandle | null>;
  time: number;
  playing: boolean;
  onPlay: () => void;
  onCue: () => void;
  pitch: number;
  onPitch: (v: number) => void;
  vinyl: boolean;
  onVinyl: (v: boolean) => void;
  onNudge: (sec: number) => void;
  onTouch: (touching: boolean) => void;
}) {
  const [quantize, setQuantize] = useState(true);
  const [keySync, setKeySync] = useState(false);
  const [sync, setSync] = useState(id === "b");
  const [pads, setPads] = useState<Pad[]>(id === "a" ? INITIAL_PADS : INITIAL_PADS.slice().reverse());
  const bpm = BASE_BPM[id] * (1 + pitch / 100);
  const letter = id.toUpperCase();

  return (
    <NeuPanel className="flex min-w-0 flex-col gap-4 p-4" role="region" aria-label={`Deck ${letter}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold tracking-[0.2em]" style={{ color }}>
          DECK {letter}
        </span>
        <span className="truncate text-xs" style={{ color: "var(--neu-muted)" }}>
          {id === "a" ? "Night Drive (Extended Mix)" : "Low Tide Dub"}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_1.35fr_0.75fr] gap-2">
        <LcdDisplay label="BPM" value={bpm.toFixed(2)} sub={fmtPitch(pitch)} accent={color} />
        <LcdDisplay label="Remain" value={`-${fmtTime(TRACK_LEN - time)}`} sub={fmtTime(time)} />
        <LcdDisplay label="Key" value={id === "a" ? "8A" : "9A"} sub={keySync ? "SYNC" : "ORIG"} />
      </div>

      <div className="flex items-center justify-center gap-4">
        <div className="flex min-w-0 flex-1 justify-center">
          <JogWheel
            ref={jogRef}
            size={260}
            color={color}
            label={`Deck ${letter} jog wheel`}
            scrubMode={vinyl}
            onNudge={onNudge}
            onScrub={onNudge}
            onTouchChange={(t) => onTouch(t && vinyl)}
          >
            <div className="flex flex-col items-center leading-none">
              <span
                className="text-[clamp(14px,4vw,22px)] font-semibold tabular-nums"
                style={{ fontFamily: "var(--neu-font-mono)" }}
              >
                {bpm.toFixed(1)}
              </span>
              <span className="neu-label mt-1">{vinyl ? "Vinyl" : "CDJ"}</span>
            </div>
          </JogWheel>
        </div>
        <Fader
          label="Tempo"
          value={pitch}
          min={-8}
          max={8}
          step={0.02}
          reverse
          centerDetent
          ticks={9}
          length={220}
          color={color}
          format={fmtPitch}
          onChange={onPitch}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <NeuToggle label="Vinyl" checked={vinyl} onCheckedChange={onVinyl} ledColor={color} />
        <NeuToggle label="Quantize" checked={quantize} onCheckedChange={setQuantize} ledColor="var(--neu-ok)" />
        <NeuToggle label="Key sync" checked={keySync} onCheckedChange={setKeySync} ledColor="var(--neu-ok)" />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <NeuButton
            variant="transport"
            led={playing ? "off" : "blink"}
            ledColor="var(--neu-warn)"
            onClick={onCue}
            aria-label={`Cue deck ${letter}`}
          >
            CUE
          </NeuButton>
          <NeuButton
            variant="transport"
            size="lg"
            active={playing}
            led={playing ? "on" : "off"}
            ledColor="var(--neu-ok)"
            onClick={onPlay}
            aria-label={`Play deck ${letter}`}
          >
            {playing ? <Pause size={22} aria-hidden /> : <Play size={22} aria-hidden />}
          </NeuButton>
          <NeuButton active={sync} led={sync ? "on" : "off"} ledColor={color} onClick={() => setSync((s) => !s)}>
            Sync
          </NeuButton>
        </div>
        <PadGrid
          className="min-w-[220px] flex-1"
          pads={pads}
          color={color}
          name={`Deck ${letter} hot cue`}
          onPress={(i) =>
            setPads((p) =>
              p[i] ? p : p.map((pad, j) => (j === i ? { color: PAD_COLORS[i], label: fmtTime(time).slice(0, 5) } : pad))
            )
          }
          onClear={(i) => setPads((p) => p.map((pad, j) => (j === i ? null : pad)))}
        />
      </div>
    </NeuPanel>
  );
}
