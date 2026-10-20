import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ReactNode;
  /** No final period. A ReactNode only so PanelEmptyState can pass its children through. */
  title: ReactNode;
  /** Full sentence(s) with a period (ReactNode only for the invalid-file code detail). */
  description?: ReactNode;
  action?: ReactNode;
  /** "page" fills a whole surface; "panel" is the compact variant for sidebars and inner panes. */
  size?: "page" | "panel";
  /** Element for the title; pages that need a landmark heading pass "h1". */
  titleAs?: "p" | "h1" | "h2";
  className?: string;
}

/** The one "nothing here" block: icon, title, description, action. */
export function EmptyState({ icon, title, description, action, size = "page", titleAs: Title = "p", className }: EmptyStateProps) {
  const panel = size === "panel";
  return (
    <div className={cn("flex max-w-sm flex-col items-center text-center", panel ? "gap-1.5" : "gap-2", className)}>
      {icon && (
        <span aria-hidden className={cn("text-text-disabled", panel ? "[&>svg]:size-5" : "[&>svg]:size-8")}>
          {icon}
        </span>
      )}
      <Title className={cn("font-medium text-text-primary", panel ? "text-xs" : "text-sm")}>{title}</Title>
      {description && <div className={cn("text-pretty text-text-muted", panel ? "text-xs" : "text-sm")}>{description}</div>}
      {action && <div className={panel ? "mt-1" : "mt-2"}>{action}</div>}
    </div>
  );
}
