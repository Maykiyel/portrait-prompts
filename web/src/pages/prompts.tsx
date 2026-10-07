import { useState } from "react";
import { Check, Copy, ExternalLink, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { useAddPrompts, usePending } from "@/lib/queries";
import { copyText, promptForGemini, summarize } from "@/lib/text";
import { cn } from "@/lib/utils";
import { useCopied } from "@/stores/copied";
import { useSettings } from "@/stores/settings";

function PromptRow({ seed, prompt, text }: { seed: number; prompt: string; text: string }) {
  const [open, setOpen] = useState(false);
  const wasCopied = useCopied((s) => s.copied[seed] === true);
  const mark = useCopied((s) => s.mark);

  const copy = async () => {
    if (await copyText(text)) {
      mark(seed);
      toast.success(`Copied prompt ${seed}`);
    } else toast.error("The browser blocked copying. Select the text and copy it by hand.");
  };

  return (
    <li className={cn("grid grid-cols-[3.5rem_1fr_auto] items-start gap-3 py-3", wasCopied && "opacity-60")}>
      <span className="pt-0.5 text-sm font-medium tabular-nums">{String(seed).padStart(5, "0")}</span>
      <div className="min-w-0">
        <p className="text-sm">{summarize(prompt)}</p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
          aria-expanded={open}
        >
          {open ? "Hide full prompt" : "Show full prompt"}
        </button>
        {open && <pre className="mt-2 rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap">{text}</pre>}
      </div>
      <Button size="sm" variant={wasCopied ? "outline" : "default"} onClick={() => void copy()}>
        {wasCopied ? <Check /> : <Copy />}
        {wasCopied ? "Copied" : "Copy"}
      </Button>
    </li>
  );
}

export function Prompts() {
  const pending = usePending();
  const add = useAddPrompts();
  const includeNegative = useSettings((s) => s.includeNegative);
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
            if (validCount) add.mutate(n, { onSuccess: () => toast.success(`Added ${n} prompts`) });
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
              <PromptRow key={seed} seed={seed} prompt={prompt} text={promptForGemini(prompt, pending.data.prefix, pending.data.negative, includeNegative)} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
