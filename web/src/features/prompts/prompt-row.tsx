import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { copyText, seedLabel, summarize } from "@/lib/text";
import { cn } from "@/shared/lib/utils";
import { useCopied } from "@/features/prompts/copied-store";

export function PromptRow({ seed, prompt }: { seed: number; prompt: string }) {
  const [open, setOpen] = useState(false);
  const wasCopied = useCopied((s) => s.copied[seed] === true);
  const mark = useCopied((s) => s.mark);

  const copy = async () => {
    if (await copyText(prompt)) {
      mark(seed);
      toast.success(`Copied prompt ${seed}`);
    } else toast.error("The browser blocked copying. Select the text and copy it by hand.");
  };

  return (
    <li className={cn("grid grid-cols-[3.5rem_1fr_auto] items-start gap-3 py-3", wasCopied && "opacity-60")}>
      <span className="pt-0.5 text-sm font-medium tabular-nums">{seedLabel(seed)}</span>
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
        {open && <pre className="mt-2 rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap">{prompt}</pre>}
      </div>
      <Button size="sm" variant={wasCopied ? "outline" : "default"} onClick={() => void copy()}>
        {wasCopied ? <Check /> : <Copy />}
        {wasCopied ? "Copied" : "Copy"}
      </Button>
    </li>
  );
}