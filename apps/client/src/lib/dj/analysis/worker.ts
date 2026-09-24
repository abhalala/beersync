// Web Worker entry: runs analyzeTrack off the main thread. Loaded by client.ts
// via `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })`.

import { analyzeTrack } from "./analyze";
import type { AnalysisWorkerRequest, AnalysisWorkerResponse } from "./protocol";

// The client tsconfig uses the DOM lib, not WebWorker; type just what we use
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<AnalysisWorkerRequest>) => void) | null;
  postMessage(message: AnalysisWorkerResponse, transfer?: Transferable[]): void;
};

ctx.onmessage = (event) => {
  const { id, channels, sampleRate } = event.data;
  try {
    const length = channels.length > 0 ? channels[0].length : 0;
    const result = analyzeTrack({
      numberOfChannels: channels.length,
      sampleRate,
      length,
      getChannelData: (i) => channels[i],
    });
    const { low, mid, high, peak } = result.waveform;
    ctx.postMessage({ id, result }, [low.buffer, mid.buffer, high.buffer, peak.buffer]);
  } catch (error) {
    ctx.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
