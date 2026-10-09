import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";

class Fault extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // React reports a render fault to the console only in dev; a production
    // report has to be written out, or a blank page leaves nothing behind.
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>This page failed to load</AlertTitle>
        <AlertDescription>
          <p>{this.state.error.message}</p>
          <Button size="sm" variant="outline" className="mt-2 text-foreground" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
}

/** Holds the routed content: the Suspense a lazy route waits on, and the catch
 *  for whatever it throws — a page's own render fault, or a chunk that never
 *  arrives. The key drops the caught fault when the path changes, so navigating
 *  off a broken page recovers instead of stranding the user on the alert. */
export function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <Fault key={pathname}>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>{children}</Suspense>
    </Fault>
  );
}