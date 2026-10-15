import { create } from "zustand";
import { persist } from "zustand/middleware";

// Read by the shell, the Overview and Prompts pages and by the toast wrapper, so
// it is app state rather than any one page's own: shared on purpose, not by
// accident. In app/ nothing beneath the root could name it, so three files had
// to reach upward for it and the boundary between the two layers meant nothing.
export type Theme = "light" | "dark" | "system";

type SettingsState = {
  theme: Theme;
  includeNegative: boolean;
  setTheme: (theme: Theme) => void;
  setIncludeNegative: (v: boolean) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "system",
      includeNegative: true,
      setTheme: (theme) => set({ theme }),
      setIncludeNegative: (includeNegative) => set({ includeNegative }),
    }),
    { name: "portrait-settings" },
  ),
);
