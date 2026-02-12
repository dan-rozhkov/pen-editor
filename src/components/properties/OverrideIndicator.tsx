import { ArrowCounterClockwise } from "@phosphor-icons/react";

export function OverrideIndicator({
  isOverridden,
  onReset,
}: {
  isOverridden: boolean;
  onReset: () => void;
}) {
  if (!isOverridden) return null;
  return (
    <button
      onClick={onReset}
      className="h-6 w-6 flex items-center justify-center rounded bg-surface-elevated text-text-muted hover:text-text-primary flex-shrink-0 transition-colors"
      title="Reset to component value"
    >
      <ArrowCounterClockwise size={12} weight="bold" />
    </button>
  );
}
