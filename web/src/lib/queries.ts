import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GenerateRequest } from "@shared/api-types";
import { api } from "./api";

export const keys = {
  status: ["status"],
  pending: ["pending"],
  pendingFor: (useNegative: boolean) => ["pending", useNegative] as const,
  images: ["images"],
  job: ["job"],
} as const;

export const useStatus = () => useQuery({ queryKey: keys.status, queryFn: api.status });
export const usePending = (useNegative: boolean) => useQuery({ queryKey: keys.pendingFor(useNegative), queryFn: () => api.pending(useNegative) });
export const useImages = () => useQuery({ queryKey: keys.images, queryFn: api.images });

export const useJob = () =>
  useQuery({
    queryKey: keys.job,
    queryFn: api.job,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1000 : false),
  });

export function useRefreshAll() {
  const qc = useQueryClient();
  return () => Promise.all([keys.status, ["pending"], keys.images].map((queryKey) => qc.invalidateQueries({ queryKey })));
}

export function useAddPrompts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ count, useNegative }: { count: number; useNegative: boolean }) => api.addPrompts(count, useNegative),
    onSuccess: (data, { useNegative }) => {
      qc.setQueryData(keys.pendingFor(useNegative), data);
      void qc.invalidateQueries({ queryKey: ["pending"] });
      void qc.invalidateQueries({ queryKey: keys.status });
    },
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
