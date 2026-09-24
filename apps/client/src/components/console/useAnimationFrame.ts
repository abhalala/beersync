import { useEffect, useRef } from "react";

/** Run `callback` every animation frame without re-rendering React */
export const useAnimationFrame = (callback: (timeMs: number) => void) => {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    let frame = 0;
    const tick = (time: number) => {
      callbackRef.current(time);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
};

/** Size a canvas's backing store to its CSS size x devicePixelRatio; returns the CSS size */
export const fitCanvas = (canvas: HTMLCanvasElement): { width: number; height: number; dpr: number } => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { width, height, dpr };
};
