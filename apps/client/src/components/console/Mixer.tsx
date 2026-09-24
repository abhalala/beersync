"use client";
import { Fader, Knob, LedMeter, NeuPanel, type LedMeterHandle } from "@/components/neu";
import { djEngine } from "@/lib/dj/engine";
import { cn } from "@/lib/utils";
import { useDjStore } from "@/store/dj";
import { useCanDj, useGlobalStore } from "@/store/global";
import type { CrossfaderAssign, DeckId, MixerChannel } from "@beatsync/shared";
import { eqKnobToDb, filterKnobToFreqs } from "@beatsync/shared";
import { useRef } from "react";
import { deckColor } from "./Deck";
import { useAnimationFrame } from "./useAnimationFrame";

const formatDb = (db: number) => (db <= -39.5 ? "KILL" : `${db >= 0 ? "+" : ""}${db.toFixed(1)} dB`);
const formatHz = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`);
const formatFilter = (v: number) => {
  const { lowpassHz, highpassHz } = filterKnobToFreqs(v);
  if (Math.abs(v) < 0.02) return "OFF";
  return v < 0 ? `LPF ${formatHz(lowpassHz)}` : `HPF ${formatHz(highpassHz)}`;
};

const ChannelStrip = ({ deckId, disabled }: { deckId: DeckId; disabled: boolean }) => {
  const channel = useDjStore((s) => s.mixer.channels[deckId]);
  const sendMixerPatch = useDjStore((s) => s.sendMixerPatch);
  const meterRef = useRef<LedMeterHandle>(null);
  const color = deckColor(deckId);

  useAnimationFrame(() => {
    meterRef.current?.setLevel(djEngine.getLevel(deckId));
  });

  const patch = (values: Partial<MixerChannel>) => sendMixerPatch({ channels: { [deckId]: values } });

  const eqKnob = (band: "eqHigh" | "eqMid" | "eqLow", label: string) => (
    <Knob
      size={46}
      bipolar
      min={-1}
      max={1}
      step={0.005}
      defaultValue={0}
      value={channel[band]}
      color={color}
      label={label}
      format={(v) => formatDb(eqKnobToDb(v))}
      disabled={disabled}
      onChange={(v) => patch({ [band]: v })}
      onCommit={(v) => patch({ [band]: v })}
    />
  );

  return (
    <div className="flex flex-col items-center gap-2" aria-label={`Channel ${deckId}`}>
      <div className="font-[family-name:var(--font-display)] text-sm font-bold" style={{ color }}>
        {deckId}
      </div>
      <Knob
        size={40}
        bipolar
        min={-12}
        max={12}
        step={0.1}
        defaultValue={0}
        value={channel.trimDb}
        color={color}
        label="Trim"
        format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} dB`}
        disabled={disabled}
        onChange={(v) => patch({ trimDb: v })}
        onCommit={(v) => patch({ trimDb: v })}
      />
      {eqKnob("eqHigh", "Hi")}
      {eqKnob("eqMid", "Mid")}
      {eqKnob("eqLow", "Low")}
      <Knob
        size={50}
        bipolar
        min={-1}
        max={1}
        step={0.005}
        defaultValue={0}
        value={channel.filter}
        color={color}
        label="Filter"
        format={formatFilter}
        disabled={disabled}
        onChange={(v) => patch({ filter: v })}
        onCommit={(v) => patch({ filter: v })}
      />
      <div className="flex items-end gap-2">
        <LedMeter ref={meterRef} segments={14} height={150} label={`Channel ${deckId} level`} />
        <Fader
          orientation="vertical"
          length={150}
          min={0}
          max={1}
          step={0.001}
          defaultValue={0.85}
          value={channel.fader}
          color={color}
          label={`Channel ${deckId} fader`}
          format={(v) => `${Math.round(v * 100)}`}
          disabled={disabled}
          onChange={(v) => patch({ fader: v })}
          onCommit={(v) => patch({ fader: v })}
        />
      </div>
      <div className="flex gap-1" role="radiogroup" aria-label={`Channel ${deckId} crossfader assign`}>
        {(["A", "THRU", "B"] as CrossfaderAssign[]).map((assign) => (
          <button
            key={assign}
            type="button"
            role="radio"
            aria-checked={channel.crossfaderAssign === assign}
            disabled={disabled}
            onClick={() => patch({ crossfaderAssign: assign })}
            className={cn(
              "neu-chip px-1.5 font-mono text-[9px]",
              channel.crossfaderAssign === assign && "neu-inset-sm text-[var(--neu-text)]"
            )}
          >
            {assign === "THRU" ? "THR" : assign}
          </button>
        ))}
      </div>
    </div>
  );
};

export const Mixer = ({ className }: { className?: string }) => {
  const mixer = useDjStore((s) => s.mixer);
  const sendMixerPatch = useDjStore((s) => s.sendMixerPatch);
  const globalVolume = useGlobalStore((s) => s.globalVolume);
  const sendGlobalVolumeUpdate = useGlobalStore((s) => s.sendGlobalVolumeUpdate);
  const canMutate = useCanDj();
  const disabled = !canMutate;

  return (
    <NeuPanel className={cn("flex flex-col items-center gap-3 p-3 sm:p-4", className)} aria-label="Mixer">
      <div className="flex w-full items-start justify-center gap-4">
        <ChannelStrip deckId="A" disabled={disabled} />
        <div className="flex flex-col items-center gap-2 pt-7">
          <Knob
            size={44}
            min={0}
            max={1}
            step={0.01}
            defaultValue={1}
            value={globalVolume}
            color="var(--neu-text)"
            label="Master"
            format={(v) => `${Math.round(v * 100)}%`}
            disabled={disabled}
            onCommit={(v) => sendGlobalVolumeUpdate(v)}
          />
          <button
            type="button"
            className="neu-chip font-mono text-[9px]"
            disabled={disabled}
            onClick={() => sendMixerPatch({ crossfaderCurve: mixer.crossfaderCurve === "smooth" ? "sharp" : "smooth" })}
            title="Crossfader curve"
          >
            {mixer.crossfaderCurve === "smooth" ? "SMOOTH" : "SHARP"}
          </button>
        </div>
        <ChannelStrip deckId="B" disabled={disabled} />
      </div>
      <div className="flex w-full flex-col items-center gap-1">
        <Fader
          orientation="horizontal"
          centerDetent
          length="100%"
          min={-1}
          max={1}
          step={0.002}
          defaultValue={0}
          value={mixer.crossfader}
          color="var(--neu-text)"
          label="Crossfader"
          format={(v) =>
            Math.abs(v) < 0.01 ? "Centre" : v < 0 ? `A ${Math.round(-v * 100)}` : `B ${Math.round(v * 100)}`
          }
          disabled={disabled}
          onChange={(v) => sendMixerPatch({ crossfader: v })}
          onCommit={(v) => sendMixerPatch({ crossfader: v })}
          className="w-full max-w-[16rem]"
        />
        <div className="flex w-full max-w-[16rem] justify-between font-mono text-[10px]">
          <span style={{ color: deckColor("A") }}>A</span>
          <span className="text-[var(--neu-muted)]">X-FADER</span>
          <span style={{ color: deckColor("B") }}>B</span>
        </div>
      </div>
    </NeuPanel>
  );
};
