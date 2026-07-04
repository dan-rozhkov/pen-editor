import type { ReactNode } from "react";

interface StatusPillProps {
  /** Vertical offset. OfflineBanner sits above PwaUpdateToast so they never overlap. */
  top: "top-2" | "top-12";
  /** Whether the pill itself should accept pointer events (only the update toast is clickable). */
  interactive?: boolean;
  /** Gap between the pill's children; the banner (icon + text) and the toast (text + button) use different values. */
  gap?: 2 | 3;
  testId: string;
  children: ReactNode;
}

// Shared shell for the small non-blocking status pills anchored to the top of
// the editor (OfflineBanner, PwaUpdateToast). The outer wrapper is always
// pointer-events-none so it never intercepts canvas/UI interaction outside
// the pill itself; only the inner pill opts back in when `interactive`.
export function StatusPill({
  top,
  interactive = false,
  gap = 2,
  testId,
  children,
}: StatusPillProps) {
  const topClass = top === "top-12" ? "top-12" : "top-2";
  const gapClass = gap === 3 ? "gap-3" : "gap-2";
  const innerPointerClass = interactive
    ? "pointer-events-auto"
    : "pointer-events-none";

  return (
    <div
      data-testid={testId}
      className={`absolute ${topClass} inset-x-0 z-50 flex justify-center pointer-events-none px-2`}
    >
      <div
        className={`${innerPointerClass} flex items-center ${gapClass} rounded-full border border-border-default bg-surface-panel px-3 py-1.5 text-xs text-text-muted shadow-[0_1px_3px_rgba(0,0,0,0.08)]`}
      >
        {children}
      </div>
    </div>
  );
}
