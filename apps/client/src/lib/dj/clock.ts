import { audioContextManager } from "@/lib/audioContextManager";
import { getFilteredOutputLatencyMs, useGlobalStore } from "@/store/global";
import { epochNow } from "@beatsync/shared";

// Bridges server time (the room's shared clock) and this device's AudioContext
// clock, using the same compensation as Beatsync's scheduled play: the NTP
// offset, the user's nudge, and the device's output latency.

/** Current server time estimate (epoch ms) */
export const serverNow = (): number => {
  const { offsetEstimate, nudgeOffsetMs } = useGlobalStore.getState();
  return epochNow() + offsetEstimate + nudgeOffsetMs;
};

/** AudioContext time at which audio must start so it is *heard* at `serverTimeMs` */
export const serverTimeToAudioTime = (serverTimeMs: number): number => {
  const ctx = audioContextManager.getContext();
  return ctx.currentTime + (serverTimeMs - serverNow() - getFilteredOutputLatencyMs()) / 1000;
};

/** Inverse of serverTimeToAudioTime */
export const audioTimeToServerTime = (audioTime: number): number => {
  const ctx = audioContextManager.getContext();
  return serverNow() + (audioTime - ctx.currentTime) * 1000 + getFilteredOutputLatencyMs();
};
