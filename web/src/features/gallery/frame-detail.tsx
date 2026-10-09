import { useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ImageItem } from "@shared/api-types";
import { Button } from "@/shared/components/ui/button";
import { DialogDescription, DialogTitle } from "@/shared/components/ui/dialog";
import { fileUrl } from "@/shared/lib/frames-api";
import { copyText, seedLabel } from "@/lib/text";
import { useRejectImage } from "./reject-image";

export function FrameDetail({ image, hasNewer, hasOlder, go, onGone }: { image: ImageItem; hasNewer: boolean; hasOlder: boolean; go: (d: -1 | 1) => void; onGone: () => void }) {
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