import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GenerateRequest } from "@shared/api-types";
import { api } from "./api";

export const keys = {
  status: ["status"],
  pending: ["pending"],
  images: ["images"],
  job: ["job"],
} as const;

export const useStatus = () => useQuery({ queryKey: keys.status, queryFn: api.status });
export const usePending = () => useQuery({ queryKey: keys.pending, queryFn: api.pending });
export const useImages = () => useQuery({ queryKey: keys.images, queryFn: api.images });

export const useJob = () =>
  useQuery({
    queryKey: keys.job,
    queryFn: api.job,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1000 : false),
  });

function useRefreshAll() {
  const qc = useQueryClient();
  return () => Promise.all([keys.status, keys.pending, keys.images].map((queryKey) => qc.invalidateQueries({ queryKey })));
}

export function useAddPrompts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (count: number) => api.addPrompts(count),
    onSuccess: (data) => {
      qc.setQueryData(keys.pending, data);
      void qc.invalidateQueries({ queryKey: keys.status });
    },
  });
}

export function useImportImages() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ files, seeds }: { files: File[]; seeds: number[] }) => api.importImages(files, seeds),
    onSuccess: refresh,
  });
}

export function useRejectImage() {
  const refresh = useRefreshAll();
  return useMutation({ mutationFn: (seed: number) => api.reject(seed), onSuccess: refresh });
}

export function useStartJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: GenerateRequest) => api.startJob(req),
    onSuccess: (job) => qc.setQueryData(keys.job, job),
  });
}
