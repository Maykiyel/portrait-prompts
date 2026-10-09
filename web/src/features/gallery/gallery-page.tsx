import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { thumbUrl } from "@/lib/api";
import { useImages } from "@/lib/queries";
import { seedLabel } from "@/lib/text";
import { FrameDetail } from "./frame-detail";

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