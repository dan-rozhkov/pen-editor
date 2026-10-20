import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-muted-foreground/40 transition-colors outline-none data-checked:bg-accent-primary focus-visible:ring-[2px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-3 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-checked:translate-x-3.5"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
