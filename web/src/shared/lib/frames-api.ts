import { useQuery } from "@tanstack/react-query";
import type { ImageItem } from "@shared/api-types";
import { http } from "./http";
import { keys } from "./queries";

const images = () => http.get<ImageItem[]>("/images").then((r) => r.data);

// Read by the Overview and Gallery pages.
export const useImages = () => useQuery({ queryKey: keys.images, queryFn: images });

export const thumbUrl = (seed: number, width: number, version: string) => `/api/images/${seed}/thumb?w=${width}&v=${encodeURIComponent(version)}`;
export const fileUrl = (seed: number, version: string, opts: { raw?: boolean; download?: boolean } = {}) =>
  `/api/images/${seed}/file?v=${encodeURIComponent(version)}${opts.raw ? "&raw=1" : ""}${opts.download ? "&download=1" : ""}`;