import { useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Download, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { ImageItem } from "@shared/api-types";
import { Button } from "@/shared/components/ui/button";
import { DialogDescription, DialogTitle } from "@/shared/components/ui/dialog";
import { Badge } from "@/shared/components/ui/badge";
import { fileUrl } from "@/shared/lib/frames-api";
import { useFrameRecord } from "@/shared/lib/frames-api";
import { copyText, seedLabel } from "@/lib/text";
import { useRejectImage } from "./reject-image";
import { useAcceptImage } from "./accept-image";

const REVIEW_REASONS = [
  "attribute_mismatch",
  "visible_artifacts",
  "not_a_portrait",
  "duplicate",
  "image_quality",
  "policy",
  "other",
] as const;

export function FrameDetail({ image, hasNewer, hasOlder, go, onGone }: { image: ImageItem; hasNewer: boolean; hasOlder: boolean; go: (d: -1 | 1) => void; onGone: () => void }) {
  const reject = useRejectImage();
  const accept = useAcceptImage();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState<string>("other");
  const [note, setNote] = useState("");
  const [accepting, setAccepting] = useState(false);
  const record = useFrameRecord(image.seed);
  const full = record.data;
  const qc = full?.frame?.qc;

  return (
    <div className="grid gap-5 sm:grid-cols-[minmax(0,17rem)_1fr]">
      <img src={fileUrl(image.seed, image.updatedAt)} alt={`Frame ${seedLabel(image.seed)}`} className="aspect-[2/3] w-full rounded-md border object-cover" />
      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <DialogTitle className="tabular-nums">Frame {seedLabel(image.seed)}</DialogTitle>
          <DialogDescription className="mt-1">
            {image.source === "manual" ? "Imported by hand" : image.source === "api" ? `Made with ${image.model ?? "the API"}` : "Source unknown"}, prompt template {image.version}.
          </DialogDescription>
          <div className="mt-2 flex flex-wrap gap-2">
            {image.reviewState && <Badge variant="secondary">Review: {image.reviewState}</Badge>}
            {image.qcStatus && <Badge variant={image.qcStatus === "fail" ? "destructive" : image.qcStatus === "warn" ? "secondary" : "outline"}>QC: {image.qcStatus}</Badge>}
          </div>
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

        {qc && (
          <div className="rounded-md border p-3 text-xs">
            <h3 className="mb-2 text-sm font-medium">Quality checks</h3>
            <p className="mb-2">Status: {qc.status}. Version {qc.version}.</p>
            <ul className="grid grid-cols-2 gap-1">
              {Object.entries(qc.checks).map(([name, state]) => (
                <li key={name} className="flex justify-between">
                  <span>{name}</span>
                  <span className="text-muted-foreground">{state === "not_run" ? "not run" : state}</span>
                </li>
              ))}
            </ul>
            {qc.flags.length > 0 && (
              <p className="mt-2">Flags: {qc.flags.join(", ")}</p>
            )}
            {qc.perceptual && <p className="mt-1">Perceptual: {qc.perceptual.algo} ({qc.perceptual.basis})</p>}
          </div>
        )}

        {full?.frame?.primaryGroup && (
          <div className="rounded-md border p-3 text-xs">
            <h3 className="mb-2 text-sm font-medium">Provenance</h3>
            <ul className="space-y-1">
              <li>Primary group: {full.frame.primaryGroup}</li>
              {full.frame.photographyProfile && <li>Photography profile: {full.frame.photographyProfile}</li>}
              {full.frame.provider != null && <li>Provider: {full.frame.provider}</li>}
              {full.frame.model != null && <li>Model: {full.frame.model}</li>}
              {full.frame.attributesSource && <li>Attributes source: {full.frame.attributesSource}</li>}
              {full.frame.templateHash && <li>Template hash: {full.frame.templateHash}</li>}
              {full.frame.samplerHash && <li>Sampler hash: {full.frame.samplerHash}</li>}
            </ul>
          </div>
        )}

        {full?.review && (
          <div className="rounded-md border p-3 text-xs">
            <h3 className="mb-2 text-sm font-medium">Review history</h3>
            <p>{full.review.review}{full.review.reason ? `: ${full.review.reason}` : ""}{full.review.note ? ` (${full.review.note})` : ""}</p>
          </div>
        )}

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

        <div className="border-t pt-3 space-y-2">
          {accepting ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Accept this frame?</span>
              <input
                className="rounded border px-2 py-1 text-xs"
                placeholder="optional note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button
                size="sm"
                disabled={accept.isPending}
                onClick={() =>
                  accept.mutate({ seed: image.seed, note: note || undefined }, {
                    onSuccess: () => { toast.success("Accepted"); setAccepting(false); },
                    onError: (e: unknown) => toast.error(String(e)),
                  })
                }
              >
                <CheckCircle2 /> Confirm accept
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAccepting(false)}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAccepting(true)}>
              <CheckCircle2 /> Accept
            </Button>
          )}

          {confirming ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Reject reason:</span>
              <select
                className="rounded border px-2 py-1 text-xs"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {REVIEW_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <input
                className="rounded border px-2 py-1 text-xs"
                placeholder="optional note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={reject.isPending}
                onClick={() =>
                  reject.mutate({ seed: image.seed, reason, note: note || undefined }, {
                    onSuccess: () => {
                      toast.success(`Prompt ${seedLabel(image.seed)} is waiting again`);
                      onGone();
                    },
                    onError: (e: unknown) => toast.error(String(e)),
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