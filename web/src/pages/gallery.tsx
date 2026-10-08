import { useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ImageItem } from "@shared/api-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { fileUrl, thumbUrl } from "@/lib/api";
import { useImages, useRejectImage } from "@/lib/queries";
import { copyText, seedLabel } from "@/lib/text";

function FrameDetail({ image, hasNewer, hasOlder, go, onGone }: { image: ImageItem; hasNewer: boolean; hasOlder: boolean; go: (d: -1 | 1) => void; onGone: () => void }) {
  const reject = useRejectImage();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="grid gap-5 sm:grid-cols-[minmax(0,17rem)_1fr]">
      <img src={fileUrl(image.seed, image.updatedAt)} alt={`Frame ${seedLabel(image.seed)}`} className="aspect-[2/3] w-full rounded-md border object-cover" />
      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <DialogTitle className="tabular-nums">Frame {seedLabel(image.seed)}</DialogTitle>
          <DialogDescription className="mt-1">
            {image.source === "manual" ? "Imported by hand" : image.source === "api" ? `Made with ${image.model ?? "the API"}` : "Source unknown"}, prompt template {image.version}.
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-medium">Prompt</h3>
            {image.prompt && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => ((await copyText(image.prompt)) ? toast.success("Copied") : toast.error("Could not copy"))}
              >
                <Copy /> Copy
              </Button>
            )}
          </div>
          <p className="max-h-52 overflow-y-auto rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap">
            {image.prompt || "No prompt was recorded for this image."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={fileUrl(image.seed, image.updatedAt, { download: true })}>
              <Download /> Download
            </a>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href={fileUrl(image.seed, image.updatedAt, { raw: true, download: true })}>Original</a>
          </Button>
          <div className="ml-auto flex gap-1">
            <Button size="icon" variant="outline" disabled={!hasNewer} onClick={() => go(-1)} aria-label="Newer image">
              <ChevronLeft />
            </Button>
            <Button size="icon" variant="outline" disabled={!hasOlder} onClick={() => go(1)} aria-label="Older image">
              <ChevronRight />
            </Button>
          </div>
        </div>

        <div className="border-t pt-3">
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Delete this image and put {seedLabel(image.seed)} back in your prompts?</span>
              <Button
                size="sm"
                variant="destructive"
                disabled={reject.isPending}
                onClick={() =>
                  reject.mutate(image.seed, {
                    onSuccess: () => {
                      toast.success(`Prompt ${seedLabel(image.seed)} is waiting again`);
                      onGone();
                    },
                  })
                }
              >
                Reject image
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirming(true)}>
              <Trash2 /> Reject and redo
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Gallery() {
  const images = useImages();
  const [selected, setSelected] = useState<number | null>(null);

  if (images.error) return <QueryError error={images.error} retry={() => void images.refetch()} />;

  const list = images.data;
  const index = list && selected !== null ? list.findIndex((i) => i.seed === selected) : -1;
  const current = list && index >= 0 ? list[index] : undefined;

  const go = (d: -1 | 1) => {
    const next = list?.[index + d];
    if (next) setSelected(next.seed);
  };
  // After a reject, move to a neighbour or close.
  const onGone = () => setSelected(list?.[index + 1]?.seed ?? list?.[index - 1]?.seed ?? null);

  return (
    <>
      <PageHeader
        title="Gallery"
        description="Newest first. Open a frame to read its prompt, download it, or reject it if the hands, teeth or eyes look wrong."
        actions={list && <Badge variant="secondary">{list.length} images</Badge>}
      />

      {!list ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="aspect-[2/3] w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium">No images yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Import your Gemini downloads or generate with the API and they appear here.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {list.map((img) => (
            <li key={img.seed}>
              <button
                type="button"
                onClick={() => setSelected(img.seed)}
                className="group block w-full text-left outline-none"
                aria-label={`Open frame ${seedLabel(img.seed)}`}
              >
                <img
                  src={thumbUrl(img.seed, 320, img.updatedAt)}
                  alt=""
                  loading="lazy"
                  className="aspect-[2/3] w-full rounded-sm border bg-muted object-cover group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50"
                />
                <span className="mt-1 block text-xs text-muted-foreground tabular-nums">{seedLabel(img.seed)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={current !== undefined} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") go(-1);
            if (e.key === "ArrowRight") go(1);
          }}
        >
          {current && list && <FrameDetail key={current.seed} image={current} hasNewer={index > 0} hasOlder={index < list.length - 1} go={go} onGone={onGone} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
