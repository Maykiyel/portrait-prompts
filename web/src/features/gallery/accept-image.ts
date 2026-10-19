import { useMutation } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { useRefreshAll } from "@/shared/lib/query-keys";

const accept = (seed: number, note?: string) =>
  http.post(`/images/${seed}/accept`, { note }).then((r) => r.data);

export function useAcceptImage() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ seed, note }: { seed: number; note?: string }) => accept(seed, note),
    onSuccess: refresh,
  });
}