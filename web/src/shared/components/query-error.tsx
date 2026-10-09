import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";

export function QueryError({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Could not load this page</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        {retry && (
          <Button size="sm" variant="outline" onClick={retry} className="mt-2 text-foreground">
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
