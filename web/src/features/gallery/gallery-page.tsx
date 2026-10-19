import { useState } from "react";
import { Badge } from "@/shared/components/ui/badge";
import { Dialog, DialogContent } from "@/shared/components/ui/dialog";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { PageHeader } from "@/shared/components/page-header";
import { QueryError } from "@/shared/components/query-error";
import { useImages, useQuarantined, thumbUrl, quarantineFileUrl } from "@/shared/lib/frames-api";
import { seedLabel } from "@/lib/text";
import { FrameDetail } from "./frame-detail";

type ReviewFilter = "all" | "unreviewed" | "accepted" | "rejected";
type QcFilter = "all" | "pass" | "warn" | "fail";

export function Gallery() {
  const images = useImages();
  const quarantined = useQuarantined();
  const [selected, setSelected] = useState<number | null>(null);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [qcFilter, setQcFilter] = useState<QcFilter>("all");
  const [showQuarantined, setShowQuarantined] = useState(false);

  if (images.error) return <QueryError error={images.error} retry={() => void images.refetch()} />;

  const list = images.data;
  const filtered = (list ?? []).filter((img) => {
    if (reviewFilter !== "all" && (img.reviewState ?? "unreviewed") !== reviewFilter) return false;
    if (qcFilter !== "all" && img.qcStatus !== qcFilter) return false;
    return true;
  });
  const index = filtered.findIndex((i) => i.seed === selected);
  const current = index >= 0 ? filtered[index] : undefined;

  const go = (d: -1 | 1) => {
    const next = filtered[index + d];
    if (next) setSelected(next.seed);
  };
  const onGone = () => setSelected(filtered[index + 1]?.seed ?? filtered[index - 1]?.seed ?? null);

  return (
    <>
      <PageHeader
        title="Gallery"
        description="Newest first. Open a frame to read its prompt, download it, or reject it if the hands, teeth or eyes look wrong."
        actions={list && <Badge variant="secondary">{list.length} images</Badge>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className="rounded border px-2 py-1 text-xs" value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value as ReviewFilter)}>
          <option value="all">All review states</option>
          <option value="unreviewed">Unreviewed</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
        </select>
        <select className="rounded border px-2 py-1 text-xs" value={qcFilter} onChange={(e) => setQcFilter(e.target.value as QcFilter)}>
          <option value="all">All QC statuses</option>
          <option value="pass">Pass</option>
          <option value="warn">Warn</option>
          <option value="fail">Fail</option>
        </select>
        <button className="rounded border px-2 py-1 text-xs" onClick={() => setShowQuarantined((v) => !v)}>
          {showQuarantined ? "Hide" : "Show"} quarantined ({quarantined.data?.length ?? 0})
        </button>
      </div>

      {!list ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="aspect-[2/3] w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium">No images match</p>
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {filtered.map((img) => (
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
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground tabular-nums">{seedLabel(img.seed)}</span>
                  <span className="flex gap-1">
                    {img.qcStatus === "warn" && <Badge variant="secondary">warn</Badge>}
                    {img.reviewState && img.reviewState !== "unreviewed" && <Badge variant="outline">{img.reviewState}</Badge>}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showQuarantined && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium">Quarantined frames (read-only)</h2>
          <ul className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-6">
            {(quarantined.data ?? []).map((q) => (
              <li key={q.seed}>
                <div className="text-xs">
                  <img src={quarantineFileUrl(q.seed)} alt="" className="aspect-[2/3] w-full rounded-sm border bg-muted object-cover" />
                  <span className="mt-1 block text-muted-foreground tabular-nums">{seedLabel(q.seed)}</span>
                  <span className="block text-destructive">{q.reason}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={current !== undefined} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") go(-1);
            if (e.key === "ArrowRight") go(1);
          }}
        >
          {current && filtered.length > 0 && <FrameDetail key={current.seed} image={current} hasNewer={index > 0} hasOlder={index < filtered.length - 1} go={go} onGone={onGone} />}
        </DialogContent>
      </Dialog>
    </>
  );
}