import { useMutation } from "@tanstack/react-query";
import type { ImportResponse } from "@shared/api-types";
import { http } from "@/shared/lib/http";
import { useRefreshAll } from "@/shared/lib/query-keys";

const importImages = (files: File[], seeds: number[]) => {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  form.append("seeds", JSON.stringify(seeds));
  return http.post<ImportResponse>("/import", form).then((r) => r.data);
};

export function useImportImages() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ files, seeds }: { files: File[]; seeds: number[] }) => importImages(files, seeds),
    onSuccess: refresh,
  });
}
