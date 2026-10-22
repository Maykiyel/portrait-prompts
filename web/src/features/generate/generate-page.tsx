import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AlertCircle, KeyRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Progress } from "@/shared/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import { PageHeader } from "@/shared/components/page-header";
import { useJob } from "@/shared/lib/job-api";
import { useRefreshAll } from "@/shared/lib/query-keys";
import { useStatus } from "@/shared/lib/status-api";
import { seedLabel } from "@/lib/text";
import { useStartJob } from "./start-job";
import { StoppedDialog } from "./stopped-dialog";

export function Generate() {
  const status = useStatus();
  const job = useJob();
  const start = useStartJob();
  const refresh = useRefreshAll();

  // The Providers, their models and their sizes all come from the server rather
  // than from a list held here, so the browser cannot offer something the
  // Provider would refuse.
  const catalog = status.data?.providers ?? [];
  const [providerId, setProviderId] = useState<string | undefined>();
  const [modelKey, setModelKey] = useState<string | undefined>();
  const [count, setCount] = useState("10");
  const [size, setSize] = useState<string | undefined>();
  const [concurrency, setConcurrency] = useState("3");
  const [useNegative, setUseNegative] = useState(true);
  // The finish time of the stopped Job whose dialog was closed, so it does not
  // open again on the next poll but does open for the next Job that stops.
  const [dismissedStop, setDismissedStop] = useState<string | undefined>();

  // Before the first Status lands nothing is chosen, so the form waits for the
  // catalog rather than guessing at a default it would then have to correct.
  const provider = catalog.find((p) => p.id === providerId) ?? catalog[0];
  // Before a model is chosen the form shows the first one the Provider offers,
  // so the control is never blank and never names something the Provider would
  // refuse; choosing another sets the key and this resolves it.
  const chosenModel = provider?.models.find((m) => m.id === modelKey) ?? provider?.models[0];
  // A model with a single size has only one, so the size control shows that one
  // rather than a choice the Provider cannot honour.
  const sizeChoices = provider?.sizes ?? [];
  const fixedSize = chosenModel?.fixedSize ?? null;
  const chosenSize = fixedSize ?? size ?? sizeChoices[0];
  const maxConcurrency = provider?.maxConcurrency ?? 8;

  const state = job.data;
  const running = state?.status === "running";
  const finished = state?.status === "done" || state?.status === "error";

  // Refresh counts and the gallery once a job ends.
  useEffect(() => {
    if (finished) void refresh();
  }, [finished, refresh]);

  const n = Number(count);
  const c = Number(concurrency);
  const valid =
    Number.isInteger(n) && n >= 1 && n <= 500 && Number.isInteger(c) && c >= 1 && c <= maxConcurrency;
  const notReady = provider ? !provider.ready : false;
  const ready = Boolean(provider && chosenModel && chosenSize);
  const handled = state ? state.done + state.failed + state.blocked : 0;
  const percent = state && state.total > 0 ? Math.round((handled / state.total) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Generate"
        description="Make images through a vendor's API with a paid key, or through Codex on your ChatGPT plan. Without either, use the Prompts and Import pages."
      />

      {notReady && provider && !provider.needsKey && (
        <Alert variant="warning" className="mb-6">
          <AlertCircle />
          <AlertTitle>{provider.label} is not ready</AlertTitle>
          <AlertDescription>
            <p>{provider.notReady}</p>
          </AlertDescription>
        </Alert>
      )}

      {notReady && provider && provider.needsKey && (
        <Alert variant="warning" className="mb-6">
          <KeyRound />
          <AlertTitle>No API key for {provider.label}</AlertTitle>
          <AlertDescription>
            <p>
              Add the key for {provider.label} to .env and restart the server. Gemini's image models
              have no free tier; OpenAI's need a card with at least $5 on it.
            </p>
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
          if (valid && ready) {
            start.mutate({
              count: n,
              provider: provider.id,
              model: chosenModel.id,
              size: chosenSize,
              concurrency: c,
              useNegative,
            });
          }
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="provider">Provider</Label>
          <Select
            value={provider?.id ?? ""}
            onValueChange={(v) => {
              setProviderId(v);
              setModelKey(undefined);
              setSize(undefined);
              // Keep the count of workers inside what the new Provider takes, so
              // switching to one that makes an image at a time does not leave the
              // form invalid with no visible reason.
              const next = catalog.find((p) => p.id === v);
              if (next && Number(concurrency) > next.maxConcurrency) setConcurrency(String(next.maxConcurrency));
            }}
          >
            <SelectTrigger id="provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {catalog.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                  {p.ready ? "" : p.needsKey ? " (no key)" : " (not ready)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="model">Model</Label>
          <Select
            value={chosenModel?.id ?? ""}
            onValueChange={(v) => {
              setModelKey(v);
              setSize(undefined);
            }}
          >
            <SelectTrigger id="model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {provider?.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="size">Size</Label>
            <Select value={chosenSize ?? ""} onValueChange={setSize} disabled={Boolean(fixedSize)}>
              <SelectTrigger id="size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizeChoices.map((s) => (
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
            <Input
              id="c"
              type="number"
              min={1}
              max={maxConcurrency}
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch id="avoid" checked={useNegative} onCheckedChange={setUseNegative} />
          <Label htmlFor="avoid">Add the "Avoid" line to each prompt</Label>
        </div>

        <div>
          <Button type="submit" disabled={!valid || !ready || notReady || running || start.isPending}>
            {running ? "Generating" : `Generate ${valid ? n : ""} images`}
          </Button>
        </div>
      </form>

      {state?.stopped && (
        <StoppedDialog
          state={state}
          open={!running && state.finishedAt !== undefined && state.finishedAt !== dismissedStop}
          onClose={() => setDismissedStop(state.finishedAt)}
        />
      )}

      {state && state.status !== "idle" && (
        <section className="mt-8 max-w-xl">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="font-medium">
              {running ? "Generating" : state.status === "done" && !state.stopped ? "Finished" : "Stopped"}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {handled} of {state.total}
              {state.failed > 0 && `, ${state.failed} failed`}
              {state.blocked > 0 && `, ${state.blocked} blocked`}
            </span>
          </div>
          <Progress value={percent} aria-label="Generation progress" />

          {state.notice && (
            <p className="mt-4 text-sm text-muted-foreground">{state.notice}</p>
          )}

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
                  <span className="w-14 shrink-0 tabular-nums">{seedLabel(l.seed)}</span>
                  <span className={l.ok ? "text-done" : l.blocked ? "text-muted-foreground" : "text-destructive"}>
                    {l.ok ? "Done" : l.blocked ? "Blocked" : (l.message ?? "Failed")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {state.failed > 0 && !running && (
            <p className="mt-3 text-sm text-muted-foreground">Failed seeds stay waiting and run first next time.</p>
          )}
          {state.blocked > 0 && !running && (
            <p className="mt-3 text-sm text-muted-foreground">
              Blocked seeds will not be offered again: the vendor refused the prompt itself.
            </p>
          )}
        </section>
      )}
    </>
  );
}