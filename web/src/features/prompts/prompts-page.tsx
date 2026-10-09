import { useState } from "react";
import { ExternalLink, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Switch } from "@/shared/components/ui/switch";
import { PageHeader } from "@/shared/components/page-header";
import { QueryError } from "@/shared/components/query-error";
import { PromptRow } from "@/features/prompts/prompt-row";
import { useAddPrompts, usePending } from "@/shared/lib/prompts-api";
import { useSettings } from "@/stores/settings";

export function Prompts() {
  const includeNegative = useSettings((s) => s.includeNegative);
  const pending = usePending(includeNegative);
  const add = useAddPrompts();
  const setIncludeNegative = useSettings((s) => s.setIncludeNegative);
  const [count, setCount] = useState("10");

  const n = Number(count);
  const validCount = Number.isInteger(n) && n >= 1 && n <= 500;

  return (
    <>
      <PageHeader
        title="Prompts"
        description="Paste each prompt into its own new Gemini chat. A shared chat can carry faces over between images."
        actions={
          <Button asChild variant="outline" size="sm">
            <a href="https://gemini.google.com/app" target="_blank" rel="noreferrer">
              Open Gemini <ExternalLink />
            </a>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-4 rounded-lg border bg-card p-4">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (validCount) add.mutate({ count: n, useNegative: includeNegative }, { onSuccess: () => toast.success(`Added ${n} prompts`) });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="count">New prompts</Label>
            <Input id="count" type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} className="w-24" aria-invalid={!validCount} />
          </div>
          <Button type="submit" disabled={!validCount || add.isPending}>
            <Plus /> Add prompts
          </Button>
        </form>
        <div className="flex items-center gap-2">
          <Switch id="neg" checked={includeNegative} onCheckedChange={setIncludeNegative} />
          <Label htmlFor="neg">Add the "Avoid" line when copying</Label>
        </div>
      </div>

      {pending.error ? (
        <QueryError error={pending.error} retry={() => void pending.refetch()} />
      ) : !pending.data ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : pending.data.items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium">No prompts are waiting</p>
          <p className="mt-1 text-sm text-muted-foreground">Add a batch above, then paste the prompts into Gemini.</p>
        </div>
      ) : (
        <>
          <p className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="waiting">{pending.data.items.length} waiting</Badge>
            Lowest numbers first. Copied prompts fade but stay until you import their image.
          </p>
          <ul className="divide-y">
            {pending.data.items.map(({ seed, prompt }) => (
              <PromptRow key={seed} seed={seed} prompt={prompt} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}