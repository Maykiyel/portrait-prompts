import { useMutation } from "@tanstack/react-query";
import { http } from "@/lib/api";
import { useRefreshAll } from "@/lib/queries";

const reject = (seed: number) => http.post(`/images/${seed}/reject`).then((r) => r.data);

export function useRejectImage() {
  const refresh = useRefreshAll();
  return useMutation({ mutationFn: (seed: number) => reject(seed), onSuccess: refresh });
}