import { create } from "zustand";
import { persist } from "zustand/middleware";

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
