import { useSyncExternalStore } from "react";
import { DEFAULT_LAYOUT, isLayoutId, type LayoutId } from "./types";

const KEY = "beersync-console-layout";
const listeners = new Set<() => void>();

const read = (): LayoutId => {
  try {
    const stored = localStorage.getItem(KEY);
    return isLayoutId(stored) ? stored : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
};

/** Console layout preset, remembered per browser (device-local, not synced to the room) */
export const useLayoutPreference = (): [LayoutId, (id: LayoutId) => void] => {
  const layout = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    read,
    (): LayoutId => DEFAULT_LAYOUT
  );
  const setLayout = (id: LayoutId) => {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // Not persisted; the change still won't stick without storage, so ignore
    }
    listeners.forEach((l) => l());
  };
  return [layout, setLayout];
};
