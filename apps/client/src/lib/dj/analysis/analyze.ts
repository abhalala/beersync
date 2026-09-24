import { detectBeatGrid } from "./bpm";
import { ANALYSIS_SAMPLE_RATE, decimate, downsampleToMono, type AudioBufferLike } from "./downsample";
import { detectKey } from "./key";
import { computeWaveform, type Waveform } from "./waveform";

export interface TrackAnalysisResult {
  bpm: number;
  firstBeatSec: number;
  bpmConfidence: number;
  /** Camelot notation, undefined when the track has no tonal content */
  key: string | undefined;
  keyConfidence: number;
  durationSec: number;
  waveform: Waveform;
}

/**
 * Waveform rate: ~22 kHz keeps hi-hat energy up to ~10 kHz in the high band
 * (11 kHz would cap it at 5.5 kHz) at half the cost of the original rate.
 */
const WAVEFORM_SAMPLE_RATE = 22050;

/** Full analysis: beat grid, key and 3-band waveform */
export const analyzeTrack = (buffer: AudioBufferLike): TrackAnalysisResult => {
  const durationSec = buffer.sampleRate > 0 ? buffer.length / buffer.sampleRate : 0;
  const wave = downsampleToMono(buffer, WAVEFORM_SAMPLE_RATE);
  const waveform = computeWaveform(wave.data, wave.sampleRate);
  const mono = decimate(wave.data, wave.sampleRate, ANALYSIS_SAMPLE_RATE);
  const grid = detectBeatGrid(mono.data, mono.sampleRate);
  const key = detectKey(mono.data, mono.sampleRate);
  return {
    bpm: grid.bpm,
    firstBeatSec: grid.firstBeatSec,
    bpmConfidence: grid.confidence,
    key: key.camelot ?? undefined,
    keyConfidence: key.confidence,
    durationSec,
    waveform,
  };
};
