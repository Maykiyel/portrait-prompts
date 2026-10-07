export type Status = {
  version: string;
  next: number;
  done: number;
  waiting: number;
  saltSet: boolean;
  hasApiKey: boolean;
  /** Set when the saved output folder cannot be used, for example after the salt changed. */
  problem?: string;
};

export type PromptItem = { seed: number; prompt: string };

export type PromptsResponse = {
  items: PromptItem[];
};

export type ImageItem = {
  seed: number;
  version: string;
  source: "api" | "manual" | "unknown";
  model?: string;
  prompt: string;
  updatedAt: string;
};

export type ImportResult = {
  seed: number;
  file: string;
  ok: boolean;
  warning?: string;
  error?: string;
};

export type ImportResponse = { results: ImportResult[] };

export type GenerateRequest = {
  count: number;
  model: "lite" | "flash" | "pro";
  size: "1K" | "2K" | "4K";
  concurrency: number;
  useNegative: boolean;
};

export type JobState = {
  status: "idle" | "running" | "done" | "error";
  model?: string;
  total: number;
  done: number;
  failed: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  log: { seed: number; ok: boolean; message?: string }[];
};
