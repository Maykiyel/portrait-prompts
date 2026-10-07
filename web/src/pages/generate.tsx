import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, KeyRound } from "lucide-react";
import type { GenerateRequest } from "@shared/api-types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { keys, useJob, useStartJob, useStatus } from "@/lib/queries";

const models = [
  { value: "flash", label: "Flash (default)" },
  { value: "lite", label: "Flash Lite (cheapest, 1K only)" },
  { value: "pro", label: "Pro (best quality)" },
] as const;

export function Generate() {
  const status = useStatus();
  const job = useJob();
  const start = useStartJob();
  const qc = useQueryClient();

  const [count, setCount] = useState("10");
  const [model, setModel] = useState<GenerateRequest["model"]>("flash");
  const [size, setSize] = useState<GenerateRequest["size"]>("1K");
  const [concurrency, setConcurrency] = useState("3");
  const [useNegative, setUseNegative] = useState(true);

  const state = job.data;
  const running = state?.status === "running";
  const finished = state?.status === "done" || state?.status === "error";

  // Refresh counts and the gallery once a job ends.
  useEffect(() => {
    if (!finished) return;
    for (const k of [keys.status, keys.pending, keys.images]) void qc.invalidateQueries({ queryKey: k });
  }, [finished, qc]);

  const n = Number(count);
  const c = Number(concurrency);
  const valid = Number.isInteger(n) && n >= 1 && n <= 500 && Number.isInteger(c) && c >= 1 && c <= 8;
  const noKey = status.data ? !status.data.hasApiKey : false;
  const handled = state ? state.done + state.failed : 0;
  const percent = state && state.total > 0 ? Math.round((handled / state.total) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Generate"
        description="Make images through the Gemini API. This needs a paid key. Without one, use the Prompts and Import pages."
      />

      {noKey && (
        <Alert variant="warning" className="mb-6">
          <KeyRound />
          <AlertTitle>No API key found</AlertTitle>
          <AlertDescription>
            <p>Add GEMINI_API_KEY to .env and restart the server. Image models have no free API tier.</p>
            <Button asChild size="sm" variant="outline" className="mt-1 text-foreground">
              <Link to="/prompts">Use the free route instead</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <form
        className="grid max-w-xl gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) start.mutate({ count: n, model, size: model === "lite" ? "1K" : size, concurrency: c, useNegative });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="model">Model</Label>
          <Select
            value={model}
            onValueChange={(v) => {
              setModel(v as GenerateRequest["model"]);
              if (v === "lite") setSize("1K");
            }}
          >
            <SelectTrigger id="model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="size">Size</Label>
            <Select value={model === "lite" ? "1K" : size} onValueChange={(v) => setSize(v as GenerateRequest["size"])} disabled={model === "lite"}>
              <SelectTrigger id="size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["1K", "2K", "4K"].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="n">Images</Label>
            <Input id="n" type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c">At once</Label>
            <Input id="c" type="number" min={1} max={8} value={concurrency} onChange={(e) => setConcurrency(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch id="avoid" checked={useNegative} onCheckedChange={setUseNegative} />
          <Label htmlFor="avoid">Add the "Avoid" line to each prompt</Label>
        </div>

        <div>
          <Button type="submit" disabled={!valid || noKey || running || start.isPending}>
            {running ? "Generating" : `Generate ${valid ? n : ""} images`}
          </Button>
        </div>
      </form>

      {state && state.status !== "idle" && (
        <section className="mt-8 max-w-xl">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="font-medium">
              {running ? "Generating" : state.status === "done" ? "Finished" : "Stopped"}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {handled} of {state.total}
              {state.failed > 0 && `, ${state.failed} failed`}
            </span>
          </div>
          <Progress value={percent} aria-label="Generation progress" />

          {state.error && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle />
              <AlertTitle>The job stopped</AlertTitle>
              <AlertDescription>
                <p>{state.error}</p>
              </AlertDescription>
            </Alert>
          )}

          {state.log.length > 0 && (
            <ul className="mt-4 divide-y text-sm">
              {state.log.map((l) => (
                <li key={`${l.seed}-${l.ok}`} className="flex gap-3 py-1.5">
                  <span className="w-14 shrink-0 tabular-nums">{String(l.seed).padStart(5, "0")}</span>
                  <span className={l.ok ? "text-done" : "text-destructive"}>{l.ok ? "Done" : (l.message ?? "Failed")}</span>
                </li>
              ))}
            </ul>
          )}
          {state.failed > 0 && !running && <p className="mt-3 text-sm text-muted-foreground">Failed seeds stay waiting and run first next time.</p>}
        </section>
      )}
    </>
  );
}
