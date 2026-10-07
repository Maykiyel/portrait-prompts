import { Link, useNavigate } from "react-router";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { thumbUrl } from "@/lib/api";
import { useAddPrompts, useImages, useStatus } from "@/lib/queries";
import { useSettings } from "@/stores/settings";

export function Overview() {
  const status = useStatus();
  const images = useImages();
  const addPrompts = useAddPrompts();
  const includeNegative = useSettings((s) => s.includeNegative);
  const navigate = useNavigate();

  if (status.error) return <QueryError error={status.error} retry={() => void status.refetch()} />;
  if (!status.data) return <Skeleton className="h-64 w-full" />;
  const s = status.data;

  const startBatch = () => addPrompts.mutate({ count: 10, useNegative: includeNegative }, { onSuccess: () => void navigate("/prompts") });

  return (
    <>
      <PageHeader title="Overview" description={`${s.done} images done, ${s.waiting} prompts waiting.`} />

      {!s.saltSet && s.next === 1 && (
        <Alert variant="warning" className="mb-6">
          <AlertTriangle />
          <AlertTitle>No seed salt yet</AlertTitle>
          <AlertDescription>
            <p>
              Without a salt, everyone who runs this repo gets the same prompts and similar portraits. Set SEED_SALT in .env and restart the
              server before your first batch. Changing it later breaks the seed to prompt link.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <section className="mb-8 rounded-lg border bg-card p-5">
        {s.waiting > 0 ? (
          <>
            <h2 className="text-lg font-semibold">{s.waiting} prompts are waiting for images</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              Paste each one into a new Gemini chat, download the image, then import your downloads.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/prompts">Copy prompts</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/import">Import images</Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">{s.done === 0 ? "Start with a small batch" : "Every prompt has an image"}</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              {s.done === 0
                ? "Add 10 prompts, paste them into Gemini and import the results. Check the faces before you scale up."
                : "Add more prompts when you are ready for the next batch."}
            </p>
            <div className="mt-4">
              <Button onClick={startBatch} disabled={addPrompts.isPending}>
                Add 10 prompts
              </Button>
            </div>
          </>
        )}
      </section>

      {images.data && images.data.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Latest images</h2>
            <Link to="/gallery" className="text-sm text-primary underline-offset-4 hover:underline">
              Open gallery
            </Link>
          </div>
          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {images.data.slice(0, 8).map((img) => (
              <li key={img.seed}>
                <Link to="/gallery" className="block overflow-hidden rounded-sm border">
                  <img src={thumbUrl(img.seed, 160, img.updatedAt)} alt={`Frame ${img.seed}`} className="aspect-[2/3] w-full object-cover" loading="lazy" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Prompt template</dt>
        <dd>{s.version}</dd>
        <dt className="text-muted-foreground">Next new seed</dt>
        <dd className="tabular-nums">{s.next}</dd>
        <dt className="text-muted-foreground">Seed salt</dt>
        <dd>{s.saltSet ? "Set" : "Not set"}</dd>
        <dt className="text-muted-foreground">Gemini API key</dt>
        <dd>{s.hasApiKey ? "Set" : "Not set"}</dd>
      </dl>
    </>
  );
}
