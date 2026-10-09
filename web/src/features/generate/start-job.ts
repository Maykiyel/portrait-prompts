import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { GenerateRequest, JobState } from "@shared/api-types";
import { http } from "@/shared/lib/http";
import { keys } from "@/shared/lib/queries";

const startJob = (req: GenerateRequest) => http.post<JobState>("/generate", req).then((r) => r.data);

export function useStartJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: GenerateRequest) => startJob(req),
    onSuccess: (job) => qc.setQueryData(keys.job, job),
  });
}