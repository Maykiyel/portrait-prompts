import { useQuery } from "@tanstack/react-query";
import type { Status } from "@shared/api-types";
import { http } from "./http";
import { keys } from "./query-keys";

const status = () => http.get<Status>("/status").then((r) => r.data);

// Read by the Overview and Generate pages and by the shell's waiting badge.
export const useStatus = () => useQuery({ queryKey: keys.status, queryFn: status });
