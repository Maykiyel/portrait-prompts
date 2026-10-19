import { useMutation } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { useRefreshAll } from "@/shared/lib/query-keys";

const reject = (seed: number, reason: string, note?: string) =>
  http.post(`/images/${seed}/reject`, { reason, note }).then((r) => r.data);

export function useRejectImage() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ seed, reason, note }: { seed: number; reason: string; note?: string }) =>
      reject(seed, reason, note),
    onSuccess: refresh,
  });
}