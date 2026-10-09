import { useMutation } from "@tanstack/react-query";
import { http } from "@/shared/lib/http";
import { useRefreshAll } from "@/shared/lib/query-keys";

const reject = (seed: number) => http.post(`/images/${seed}/reject`).then((r) => r.data);

export function useRejectImage() {
  const refresh = useRefreshAll();
  return useMutation({ mutationFn: (seed: number) => reject(seed), onSuccess: refresh });
}
