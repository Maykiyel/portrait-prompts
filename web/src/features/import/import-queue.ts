import { create } from "zustand";

export type QueueRow = {
  id: string;
  file: File;
  url: string;
  width: number;
  height: number;
  seed: number | null;
};

type QueueState = {
  rows: QueueRow[];
  addFiles: (files: File[], pending: number[]) => Promise<void>;
  autoAssign: (pending: number[]) => void;
  setSeed: (id: string, seed: number) => void;
  remove: (ids: string[]) => void;
  clear: () => void;
};

async function readSize(file: File): Promise<{ width: number; height: number }> {
  try {
    const bmp = await createImageBitmap(file);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    return { width: 0, height: 0 };
  }
}

/** Gives every row without a seed the lowest waiting seed that no row uses yet. */
function assign(rows: QueueRow[], pending: number[]): QueueRow[] {
  const used = new Set(rows.flatMap((r) => (r.seed === null ? [] : [r.seed])));
  const free = pending.filter((s) => !used.has(s));
  return rows.map((r) => (r.seed === null ? { ...r, seed: free.shift() ?? null } : r));
}

const byDownloadTime = (a: QueueRow, b: QueueRow) => a.file.lastModified - b.file.lastModified || a.file.name.localeCompare(b.file.name);

export const useImportQueue = create<QueueState>()((set, get) => ({
  rows: [],
  addFiles: async (files, pending) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    const added = await Promise.all(
      images.map(async (file): Promise<QueueRow> => ({
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
        seed: null,
        ...(await readSize(file)),
      })),
    );
    set({ rows: assign([...get().rows, ...added].sort(byDownloadTime), pending) });
  },
  autoAssign: (pending) => {
    const next = assign(get().rows, pending);
    if (next.some((r, i) => r.seed !== get().rows[i].seed)) set({ rows: next });
  },
  setSeed: (id, seed) =>
    set((s) => {
      const target = s.rows.find((r) => r.id === id);
      if (!target) return s;
      return {
        rows: s.rows.map((r) => {
          if (r.id === id) return { ...r, seed };
          if (r.seed === seed) return { ...r, seed: target.seed }; // swap
          return r;
        }),
      };
    }),
  remove: (ids) => {
    const drop = new Set(ids);
    for (const r of get().rows) if (drop.has(r.id)) URL.revokeObjectURL(r.url);
    set({ rows: get().rows.filter((r) => !drop.has(r.id)) });
  },
  clear: () => {
    for (const r of get().rows) URL.revokeObjectURL(r.url);
    set({ rows: [] });
  },
}));
