import type * as React from "react";
import { cn } from "@/shared/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
