import { useMutation } from "@tanstack/react-query";
import type { ImportResponse } from "@shared/api-types";
import { http } from "@/lib/api";
import { useRefreshAll } from "@/lib/queries";

export const importImages = (files: File[], seeds: number[]) => {
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