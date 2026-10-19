import { useQuery } from "@tanstack/react-query";
import type { ImageItem, SeedRecordItem } from "@shared/api-types";
import { http } from "./http";
import { keys } from "./query-keys";

const images = () => http.get<ImageItem[]>("/images").then((r) => r.data);

// Read by the Overview and Gallery pages.
export const useImages = () => useQuery({ queryKey: keys.images, queryFn: images });

export const useFrameRecord = (seed: number | null) =>
  useQuery({
    queryKey: ["frame", seed],
    queryFn: () => http.get<SeedRecordItem>(`/images/${seed}`).then((r) => r.data),
    enabled: seed !== null,
  });

export type QuarantinedFrame = {
  seed: number;
  reason: string;
  kind: "ingestion" | "review";
  frame?: string;
  raw?: string;
};

const quarantined = () => http.get<QuarantinedFrame[]>("/quarantine").then((r) => r.data);
export const useQuarantined = () => useQuery({ queryKey: ["quarantine"], queryFn: quarantined });

export const thumbUrl = (seed: number, width: number, version: string) => `/api/images/${seed}/thumb?w=${width}&v=${encodeURIComponent(version)}`;
export const fileUrl = (seed: number, version: string, opts: { raw?: boolean; download?: boolean } = {}) =>
  `/api/images/${seed}/file?v=${encodeURIComponent(version)}${opts.raw ? "&raw=1" : ""}${opts.download ? "&download=1" : ""}`;
export const quarantineFileUrl = (seed: number) => `/api/quarantine/${seed}/file`;
