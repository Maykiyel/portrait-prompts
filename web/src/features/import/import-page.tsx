import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { PageHeader } from "@/shared/components/page-header";
import { QueryError } from "@/shared/components/query-error";
import { useAddPrompts, usePending } from "@/shared/lib/prompts-api";
import { seedLabel, summarize } from "@/lib/text";
import { cn } from "@/shared/lib/utils";
import { useImportImages } from "@/features/import/import-api";
import { useImportQueue } from "@/features/import/import-queue";

export function ImportPage() {
  const pending = usePending(false);
  const importer = useImportImages();
  const addPrompts = useAddPrompts();
  const { rows, addFiles, autoAssign, setSeed, remove, clear } = useImportQueue();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const waitingSeeds = pending.data?.items.map((i) => i.seed) ?? [];
  const promptBySeed = new Map(pending.data?.items.map((i) => [i.seed, i.prompt]) ?? []);
  const waitingKey = waitingSeeds.join(",");

  // Rows without a seed pick one up as soon as more prompts exist.
  useEffect(() => {
    autoAssign(waitingKey ? waitingKey.split(",").map(Number) : []);
  }, [waitingKey, autoAssign]);

  const unassigned = rows.filter((r) => r.seed === null).length;
  const ready = rows.length > 0 && unassigned === 0;

  const take = (list: FileList | null) => {
    if (list?.length) void addFiles([...list], waitingSeeds);
  };

  const submit = () => {
    const files = rows.map((r) => r.file);
    const seeds = rows.map((r) => r.seed as number);
    importer.mutate(
      { files, seeds },
      {
        onSuccess: ({ results }) => {
          const okSeeds = new Set(results.filter((r) => r.ok).map((r) => r.seed));
          remove(rows.filter((r) => r.seed !== null && okSeeds.has(r.seed)).map((r) => r.id));
          const failed = results.filter((r) => !r.ok);
          if (okSeeds.size) toast.success(`Imported ${okSeeds.size} ${okSeeds.size === 1 ? "image" : "images"}`);
          for (const f of failed) toast.error(`${f.file}: ${f.error}`);
          for (const w of results.filter((r) => r.warning)) toast.warning(`${w.file}: ${w.warning}`);
        },
      },
    );
  };

  if (pending.error) return <QueryError error={pending.error} retry={() => void pending.refetch()} />;

  return (
    <>
      <PageHeader
        title="Import"
        description="Drop the images you downloaded from Gemini. Oldest download goes to the lowest waiting prompt. Check each match before you import."
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files);
        }}
        className={cn("rounded-lg border-2 border-dashed p-8 text-center transition-colors", dragging ? "border-primary bg-accent" : "border-input")}
      >
        <ImagePlus className="mx-auto mb-2 size-6 text-muted-foreground" />
        <p className="text-sm font-medium">Drop images here</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => (take(e.target.files), (e.target.value = ""))} />
      </div>

      {unassigned > 0 && (
        <Alert variant="warning" className="mt-4">
          <AlertTriangle />
          <AlertTitle>
            {unassigned} {unassigned === 1 ? "image has" : "images have"} no waiting prompt
          </AlertTitle>
          <AlertDescription>
            <p>Each image needs a prompt. Add prompts and they are matched automatically.</p>
            <div className="mt-1 flex gap-2">
              <Button size="sm" variant="outline" className="text-foreground" disabled={addPrompts.isPending} onClick={() => addPrompts.mutate({ count: unassigned, useNegative: false })}>
                Add {unassigned} {unassigned === 1 ? "prompt" : "prompts"}
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link to="/prompts">Open prompts</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {rows.length > 0 && (
        <>
          <ul className="mt-6 divide-y">
            {rows.map((row) => {
              const wrongShape = row.width > 0 && Math.abs(row.width / row.height / (2 / 3) - 1) > 0.06;
              const prompt = row.seed === null ? undefined : promptBySeed.get(row.seed);
              return (
                <li key={row.id} className="grid grid-cols-[4rem_1fr] gap-4 py-3 sm:grid-cols-[4rem_1fr_9rem_auto]">
                  <img src={row.url} alt="" className="aspect-[2/3] w-16 rounded-sm border object-cover" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.file.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {row.width}x{row.height}
                      {wrongShape && (
                        <Badge variant="waiting" className="ml-2">
                          Not 2:3, will be cropped
                        </Badge>
                      )}
                    </p>
                    {prompt && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{summarize(prompt)}</p>}
                  </div>
                  <div className="col-span-2 flex items-center gap-2 sm:col-span-2">
                    <Select value={row.seed === null ? "" : String(row.seed)} onValueChange={(v) => setSeed(row.id, Number(v))}>
                      <SelectTrigger aria-label={`Prompt for ${row.file.name}`} className="w-36 tabular-nums">
                        <SelectValue placeholder="No prompt" />
                      </SelectTrigger>
                      <SelectContent>
                        {waitingSeeds.map((s) => (
                          <SelectItem key={s} value={String(s)} className="tabular-nums">
                            {seedLabel(s)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" onClick={() => remove([row.id])} aria-label={`Remove ${row.file.name}`}>
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-3 border-t bg-background/95 py-3 backdrop-blur">
            <Button variant="ghost" onClick={clear}>
              Clear all
            </Button>
            <Button onClick={submit} disabled={!ready || importer.isPending}>
              {importer.isPending ? "Importing" : `Import ${rows.length} ${rows.length === 1 ? "image" : "images"}`}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
