import type { TrackAnalysisResult } from "./analyze";

/** Main thread -> analysis worker. Channel buffers are transferred (copies, never the AudioBuffer's own). */
export interface AnalysisWorkerRequest {
  id: number;
  channels: Float32Array[];
  sampleRate: number;
}

/** Analysis worker -> main thread. Waveform arrays are transferred. */
export type AnalysisWorkerResponse = { id: number; result: TrackAnalysisResult } | { id: number; error: string };
