import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";

interface PanelEmptyStateProps {
  icon: ReactNode;
  children: ReactNode;
}

/** Consistent vertically centered empty state for left-sidebar panel bodies. */
export function PanelEmptyState({ icon, children }: PanelEmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-10">
      <EmptyState size="panel" icon={icon} title={children} />
    </div>
  );
}
