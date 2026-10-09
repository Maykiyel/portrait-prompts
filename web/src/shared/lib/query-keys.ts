import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

export const keys = {
  status: ["status"],
  pending: ["pending"],
  pendingFor: (useNegative: boolean) => ["pending", useNegative] as const,
  images: ["images"],
  job: ["job"],
} as const;

// What every mutation has to refresh. Feature mutations call this rather than
// spelling the list out again. Stable, so a caller can list it as an effect dep.
export function useRefreshAll() {
  const qc = useQueryClient();
  return useCallback(
    () => Promise.all([keys.status, keys.pending, keys.images].map((queryKey) => qc.invalidateQueries({ queryKey }))),
    [qc],
  );
}
