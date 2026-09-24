import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";
const KEY = "beersync-theme";
const listeners = new Set<() => void>();

const read = (): Theme => {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};

/** Console theme, remembered per browser */
export const useNeuTheme = (): [Theme, () => void] => {
  const theme = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    read,
    (): Theme => "dark"
  );
  const toggle = () => {
    try {
      localStorage.setItem(KEY, theme === "dark" ? "light" : "dark");
    } catch {
      // Not persisted; the toggle still can't take effect without storage, so ignore
    }
    listeners.forEach((l) => l());
  };
  return [theme, toggle];
};
