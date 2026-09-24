import { analyzeTrack, type TrackAnalysisResult } from "./analyze";
import type { AnalysisWorkerRequest, AnalysisWorkerResponse } from "./protocol";

interface PendingRequest {
  buffer: AudioBuffer;
  resolve: (result: TrackAnalysisResult) => void;
  reject: (error: unknown) => void;
}

// undefined = not created yet, null = unavailable (fall back to main thread)
let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, PendingRequest>();

const analyzeOnMainThread = (buffer: AudioBuffer): Promise<TrackAnalysisResult> =>
  new Promise((resolve, reject) => {
    // Yield first so the caller's UI update (e.g. "analyzing…") can paint
    setTimeout(() => {
      try {
        resolve(analyzeTrack(buffer));
      } catch (error) {
        reject(error);
      }
    }, 0);
  });

const settleOnMainThread = (request: PendingRequest): void => {
  analyzeOnMainThread(request.buffer).then(request.resolve, request.reject);
};

const disableWorker = (): void => {
  worker?.terminate();
  worker = null;
  const stranded = [...pending.values()];
  pending.clear();
  stranded.forEach(settleOnMainThread);
};

const getWorker = (): Worker | null => {
  if (worker !== undefined) return worker;
  if (typeof Worker === "undefined") return (worker = null);
  try {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
      const data = event.data;
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if ("result" in data) request.resolve(data.result);
      else {
        console.warn("[analysis] worker failed, retrying on main thread:", data.error);
        settleOnMainThread(request);
      }
    };
    // Script failed to load or crashed: everything in flight is lost with it
    w.onerror = (event) => {
      console.warn("[analysis] worker error, falling back to main thread:", event.message);
      event.preventDefault();
      disableWorker();
    };
    w.onmessageerror = () => disableWorker();
    worker = w;
  } catch (error) {
    console.warn("[analysis] could not start worker, using main thread:", error);
    worker = null;
  }
  return worker;
};

/**
 * Analyze a decoded track (beat grid, key, waveform) in a shared Web Worker,
 * falling back to the main thread when workers are unavailable or fail.
 */
export const analyzeInWorker = (buffer: AudioBuffer): Promise<TrackAnalysisResult> => {
  const w = getWorker();
  if (!w) return analyzeOnMainThread(buffer);

  return new Promise((resolve, reject) => {
    const id = nextId++;
    const request: PendingRequest = { buffer, resolve, reject };
    // Transfer copies: detaching the AudioBuffer's own channel data would break playback
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice());
    const message: AnalysisWorkerRequest = { id, channels, sampleRate: buffer.sampleRate };
    pending.set(id, request);
    try {
      w.postMessage(
        message,
        channels.map((ch) => ch.buffer)
      );
    } catch (error) {
      console.warn("[analysis] postMessage failed, using main thread:", error);
      pending.delete(id);
      settleOnMainThread(request);
    }
  });
};
