import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PromptsResponse } from "@shared/api-types";
import { http } from "./http";
import { keys } from "./queries";

const pending = (useNegative: boolean) => http.get<PromptsResponse>("/prompts/pending", { params: { useNegative: useNegative ? "1" : "0" } }).then((r) => r.data);
const addPrompts = (count: number, useNegative: boolean) => http.post<PromptsResponse>("/prompts/new", { count, useNegative }).then((r) => r.data);

// Read by the Prompts and Import pages.
export const usePending = (useNegative: boolean) => useQuery({ queryKey: keys.pendingFor(useNegative), queryFn: () => pending(useNegative) });

// Shared on purpose, not by accident: the Prompts, Overview and Import pages all
// add Prompts, so it belongs to none of the three on its own.
export function useAddPrompts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ count, useNegative }: { count: number; useNegative: boolean }) => addPrompts(count, useNegative),
    onSuccess: (data, { useNegative }) => {
      qc.setQueryData(keys.pendingFor(useNegative), data);
      void qc.invalidateQueries({ queryKey: ["pending"] });
      void qc.invalidateQueries({ queryKey: keys.status });
    },
  });
}