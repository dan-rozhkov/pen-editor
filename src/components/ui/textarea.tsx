import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "bg-secondary text-secondary-foreground focus-visible:ring-1 focus-visible:ring-[#0d99ff] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 rounded-md px-2 py-1.5 text-sm transition-colors aria-invalid:ring-[2px] md:text-xs/relaxed placeholder:text-muted-foreground field-sizing-content min-h-16 w-full min-w-0 outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
