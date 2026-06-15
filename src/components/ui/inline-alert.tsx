import type { ComponentProps, ReactNode } from "react";
import { WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const inlineAlertVariants = cva(
  "flex items-center gap-3 rounded-md border border-border-default bg-surface-panel px-3 py-2 text-sm text-text-primary shadow-[0_1px_3px_rgba(0,0,0,0.08)]",
  {
    variants: {
      variant: {
        default: "",
        error: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const inlineAlertIconVariants = cva("shrink-0", {
  variants: {
    variant: {
      default: "text-text-muted",
      error: "text-red-500/80",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

type InlineAlertProps = ComponentProps<"div"> &
  VariantProps<typeof inlineAlertVariants> & {
    children: ReactNode;
    dismissLabel?: string;
    icon?: ReactNode;
    onDismiss?: () => void;
  };

function InlineAlert({
  children,
  className,
  dismissLabel = "Dismiss",
  icon,
  onDismiss,
  role = "alert",
  variant = "default",
  ...props
}: InlineAlertProps) {
  const alertIcon =
    icon ??
    (variant === "error" ? <WarningCircleIcon size={18} weight="fill" /> : null);

  return (
    <div
      data-slot="inline-alert"
      role={role}
      className={cn(inlineAlertVariants({ variant, className }))}
      {...props}
    >
      {alertIcon && (
        <span
          data-slot="inline-alert-icon"
          className={cn(inlineAlertIconVariants({ variant }))}
        >
          {alertIcon}
        </span>
      )}
      <span data-slot="inline-alert-content" className="min-w-0 flex-1 truncate">
        {children}
      </span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 text-text-muted hover:bg-surface-hover hover:text-text-primary"
          aria-label={dismissLabel}
          title={dismissLabel}
        >
          <XIcon size={16} />
        </button>
      )}
    </div>
  );
}

export { InlineAlert, inlineAlertVariants };
