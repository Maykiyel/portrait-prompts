import { useQuery } from "@tanstack/react-query";
import type { JobState } from "@shared/api-types";
import { http } from "./http";
import { keys } from "./queries";

const job = () => http.get<JobState>("/generate/job").then((r) => r.data);

// The Generate page is the only caller today; the job is app state rather than a
// page's own, and the shared folder is where the next page to watch it looks.
export const useJob = () =>
  useQuery({
    queryKey: keys.job,
    queryFn: job,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1000 : false),
  });