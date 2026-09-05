import type { ReactNode } from "react";

interface StatusPillProps {
  testId: string;
  children: ReactNode;
}

// Shared shell for small non-blocking status pills anchored to the top of
// the editor (currently just OfflineBanner). The wrapper is always
// pointer-events-none so it never intercepts canvas/UI interaction outside
// the pill itself.
export function StatusPill({ testId, children }: StatusPillProps) {
  return (
    <div
      data-testid={testId}
      className="absolute top-2 inset-x-0 z-50 flex justify-center pointer-events-none px-2"
    >
      <div className="pointer-events-none flex items-center gap-2 rounded-full border border-border-default bg-surface-panel px-3 py-1.5 text-xs text-text-muted shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        {children}
      </div>
    </div>
  );
}
