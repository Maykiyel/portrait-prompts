import type { JobState } from "@shared/api-types";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/components/ui/dialog";

const TITLES: Record<NonNullable<JobState["stopped"]>["reason"], string> = {
  "usage-limit": "ChatGPT has stopped giving images for now",
  "signed-out": "Codex is signed out",
  "repeated-failure": "The run stopped after repeated failures",
};

/**
 * Shown once when a Job halts before trying every Seed it claimed. The Seeds it
 * never reached are still waiting, and the next run offers them first.
 */
export function StoppedDialog({
  state,
  open,
  onClose,
}: {
  state: JobState;
  open: boolean;
  onClose: () => void;
}) {
  const stopped = state.stopped;
  if (!stopped) return null;
  const waiting = Math.max(0, state.total - state.done - state.blocked);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{TITLES[stopped.reason]}</DialogTitle>
        <DialogDescription>{stopped.message}</DialogDescription>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Images made</dt>
          <dd className="tabular-nums">{state.done}</dd>
          <dt className="text-muted-foreground">Still waiting</dt>
          <dd className="tabular-nums">{waiting}</dd>
          {stopped.resetsAt && (
            <>
              <dt className="text-muted-foreground">Try again</dt>
              <dd>{stopped.resetsAt}</dd>
            </>
          )}
        </dl>
        {stopped.reason === "signed-out" && (
          <p className="text-sm">
            Run <code className="rounded bg-muted px-1 py-0.5 text-xs">codex login</code> in a terminal, choose
            ChatGPT, then start again.
          </p>
        )}
        <p className="text-sm text-muted-foreground">Waiting seeds run first next time.</p>
        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
