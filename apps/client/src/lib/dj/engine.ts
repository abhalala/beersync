import { audioContextManager } from "@/lib/audioContextManager";
import { audioTimeToServerTime, serverTimeToAudioTime } from "@/lib/dj/clock";
import type { DeckId, DeckState, MixerState } from "@beatsync/shared";
import {
  crossfaderGainFor,
  crossfaderGains,
  dbToGain,
  deckPositionAt,
  deckRate,
  eqKnobToDb,
  filterKnobToFreqs,
} from "@beatsync/shared";

// Per-deck Web Audio chain, feeding Beatsync's master input so global volume,
// spatial gain and the room low-pass still apply on top of the mix:
//
//   source -> trim -> low shelf -> mid peak -> high shelf -> HPF -> LPF -> fader*xfader -> analyser
//                                                                                        \-> master input

const EQ_LOW_HZ = 220;
const EQ_MID_HZ = 1000;
const EQ_HIGH_HZ = 3800;
const PARAM_SMOOTHING = 0.012; // seconds (time constant for knob moves)
const START_MARGIN_SEC = 0.03; // minimum lead time when a start time is already in the past
const CONTINUITY_TOLERANCE_SEC = 0.004;

const sameLoop = (a: DeckState["loop"], b: DeckState["loop"]): boolean =>
  (a === null && b === null) || (a !== null && b !== null && a.startSec === b.startSec && a.endSec === b.endSec);

/**
 * Whether `next` continues the timeline a voice is already playing for `prev`,
 * so the voice must keep running (at most a rate change) instead of restarting.
 * An unchanged snapshot (e.g. DJ_STATE re-sent on reconnect) always continues:
 * the comparison is in server time, independent of this device's clock offset.
 */
export const isDeckContinuation = (prev: DeckState, next: DeckState): boolean => {
  if (prev.trackUrl !== next.trackUrl || prev.status !== "playing" || next.status !== "playing") return false;
  if (!sameLoop(prev.loop, next.loop)) return false;
  if (
    prev.anchorServerTime === next.anchorServerTime &&
    prev.anchorPositionSec === next.anchorPositionSec &&
    prev.pitchPercent === next.pitchPercent
  )
    return true;
  const expected = deckPositionAt(prev, next.anchorServerTime);
  return Math.abs(expected - next.anchorPositionSec) < CONTINUITY_TOLERANCE_SEC;
};

interface Channel {
  trim: GainNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  highpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  output: GainNode;
  analyser: AnalyserNode;
  levelData: Float32Array<ArrayBuffer>;
}

interface Voice {
  source: AudioBufferSourceNode;
  deck: DeckState;
  buffer: AudioBuffer;
}

class DjEngine {
  private channels: Partial<Record<DeckId, Channel>> = {};
  private voices: Partial<Record<DeckId, Voice>> = {};

  private channel(deckId: DeckId): Channel {
    const existing = this.channels[deckId];
    if (existing) return existing;

    const ctx = audioContextManager.getContext();
    const trim = ctx.createGain();
    const low = ctx.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = EQ_LOW_HZ;
    const mid = ctx.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = EQ_MID_HZ;
    mid.Q.value = 0.7;
    const high = ctx.createBiquadFilter();
    high.type = "highshelf";
    high.frequency.value = EQ_HIGH_HZ;
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 10;
    highpass.Q.value = 0.9;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 22000;
    lowpass.Q.value = 0.9;
    const output = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;

    trim.connect(low).connect(mid).connect(high).connect(highpass).connect(lowpass).connect(output);
    output.connect(audioContextManager.getInputNode());
    output.connect(analyser);

    const channel: Channel = {
      trim,
      low,
      mid,
      high,
      highpass,
      lowpass,
      output,
      analyser,
      levelData: new Float32Array(analyser.fftSize),
    };
    this.channels[deckId] = channel;
    return channel;
  }

  private stopVoice(deckId: DeckId, atAudioTime?: number) {
    const voice = this.voices[deckId];
    if (!voice) return;
    try {
      voice.source.stop(atAudioTime);
    } catch {
      // Already stopped
    }
    if (atAudioTime === undefined) voice.source.disconnect();
    delete this.voices[deckId];
  }

  /**
   * Reconcile a deck snapshot into scheduled audio. Snapshots that continue the
   * current timeline (tempo change, hot cue edit, claim) never restart the source,
   * so they are glitch-free; discontinuities restart it at the exact anchor time.
   */
  applyDeck(deck: DeckState, buffer: AudioBuffer | undefined): void {
    const ctx = audioContextManager.getContext();
    if (ctx.state !== "running") return;
    const channel = this.channel(deck.deckId);
    const voice = this.voices[deck.deckId];
    const anchorAudioTime = serverTimeToAudioTime(deck.anchorServerTime);

    if (deck.status !== "playing" || !deck.trackUrl || !buffer) {
      this.stopVoice(deck.deckId, voice ? Math.max(ctx.currentTime, anchorAudioTime) : undefined);
      return;
    }

    if (voice && this.isContinuation(voice, deck, buffer)) {
      const when = Math.max(ctx.currentTime, anchorAudioTime);
      voice.source.playbackRate.setValueAtTime(deckRate(deck), when);
      voice.deck = deck;
      return;
    }

    const startAudioTime = Math.max(anchorAudioTime, ctx.currentTime + START_MARGIN_SEC);
    const offset = deckPositionAt(deck, audioTimeToServerTime(startAudioTime));
    if (offset >= buffer.duration) {
      this.stopVoice(deck.deckId, Math.max(ctx.currentTime, anchorAudioTime));
      return;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = deckRate(deck);
    if (deck.loop) {
      source.loop = true;
      source.loopStart = deck.loop.startSec;
      source.loopEnd = deck.loop.endSec;
    }
    source.connect(channel.trim);

    // Hand over sample-accurately: old source stops exactly when the new one starts
    if (voice) {
      try {
        voice.source.stop(startAudioTime);
      } catch {
        // Already stopped
      }
      const old = voice.source;
      old.onended = () => old.disconnect();
    }
    source.start(startAudioTime, offset);
    this.voices[deck.deckId] = { source, deck, buffer };
  }

  private isContinuation(voice: Voice, deck: DeckState, buffer: AudioBuffer): boolean {
    return voice.buffer === buffer && isDeckContinuation(voice.deck, deck);
  }

  applyMixer(mixer: MixerState): void {
    const ctx = audioContextManager.getContext();
    const now = ctx.currentTime;
    const gains = crossfaderGains(mixer.crossfader, mixer.crossfaderCurve);
    for (const deckId of ["A", "B"] as const) {
      const ch = this.channel(deckId);
      const settings = mixer.channels[deckId];
      const { lowpassHz, highpassHz } = filterKnobToFreqs(settings.filter);
      ch.trim.gain.setTargetAtTime(dbToGain(settings.trimDb), now, PARAM_SMOOTHING);
      ch.low.gain.setTargetAtTime(eqKnobToDb(settings.eqLow), now, PARAM_SMOOTHING);
      ch.mid.gain.setTargetAtTime(eqKnobToDb(settings.eqMid), now, PARAM_SMOOTHING);
      ch.high.gain.setTargetAtTime(eqKnobToDb(settings.eqHigh), now, PARAM_SMOOTHING);
      ch.lowpass.frequency.setTargetAtTime(lowpassHz, now, PARAM_SMOOTHING);
      ch.highpass.frequency.setTargetAtTime(highpassHz, now, PARAM_SMOOTHING);
      const faderGain = settings.fader * settings.fader * crossfaderGainFor(settings.crossfaderAssign, gains);
      ch.output.gain.setTargetAtTime(faderGain, now, PARAM_SMOOTHING);
    }
  }

  /** Post-fader peak level for meters, 0..1 */
  getLevel(deckId: DeckId): number {
    const ch = this.channels[deckId];
    if (!ch) return 0;
    ch.analyser.getFloatTimeDomainData(ch.levelData);
    let peak = 0;
    for (let i = 0; i < ch.levelData.length; i++) {
      const v = Math.abs(ch.levelData[i]);
      if (v > peak) peak = v;
    }
    return Math.min(1, peak);
  }

  stopAll(): void {
    for (const deckId of ["A", "B"] as const) this.stopVoice(deckId);
  }
}

export const djEngine = new DjEngine();
