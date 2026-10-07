import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** Which prompts you already pasted into Gemini. Lasts for the browser tab session. */
type CopiedState = {
  copied: Record<number, true>;
  mark: (seed: number) => void;
};

export const useCopied = create<CopiedState>()(
  persist(
    (set) => ({
      copied: {},
      mark: (seed) => set((s) => ({ copied: { ...s.copied, [seed]: true } })),
    }),
    { name: "portrait-copied", storage: createJSONStorage(() => sessionStorage) },
  ),
);
