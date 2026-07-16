import type { ReactNode } from "react";

interface PanelEmptyStateProps {
  icon: ReactNode;
  children: ReactNode;
}

/** Consistent vertically centered empty state for left-sidebar panel bodies. */
export function PanelEmptyState({ icon, children }: PanelEmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center text-text-muted">
      {icon}
      <p className="text-xs">{children}</p>
    </div>
  );
}
