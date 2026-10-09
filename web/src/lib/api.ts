import axios from "axios";
import type {
  ImageItem, ImportResponse, JobState, PromptsResponse, Status,
} from "@shared/api-types";

export const http = axios.create({ baseURL: "/api" });

// Turn the server's { error } body into a normal Error message.
http.interceptors.response.use(
  (r) => r,
  (err: unknown) => {
    if (axios.isAxiosError<{ error?: string }>(err)) {
      const msg = err.response?.data?.error ?? (err.response ? err.message : "Cannot reach the server. Is it running?");
      return Promise.reject(new Error(msg));
    }
    return Promise.reject(err);
  },
);

export const api = {
  status: () => http.get<Status>("/status").then((r) => r.data),
  pending: (useNegative: boolean) => http.get<PromptsResponse>("/prompts/pending", { params: { useNegative: useNegative ? "1" : "0" } }).then((r) => r.data),
  addPrompts: (count: number, useNegative: boolean) => http.post<PromptsResponse>("/prompts/new", { count, useNegative }).then((r) => r.data),
  images: () => http.get<ImageItem[]>("/images").then((r) => r.data),
  reject: (seed: number) => http.post(`/images/${seed}/reject`).then((r) => r.data),
  importImages: (files: File[], seeds: number[]) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    form.append("seeds", JSON.stringify(seeds));
    return http.post<ImportResponse>("/import", form).then((r) => r.data);
  },
  job: () => http.get<JobState>("/generate/job").then((r) => r.data),
};

export const thumbUrl = (seed: number, width: number, version: string) => `/api/images/${seed}/thumb?w=${width}&v=${encodeURIComponent(version)}`;
export const fileUrl = (seed: number, version: string, opts: { raw?: boolean; download?: boolean } = {}) =>
  `/api/images/${seed}/file?v=${encodeURIComponent(version)}${opts.raw ? "&raw=1" : ""}${opts.download ? "&download=1" : ""}`;
