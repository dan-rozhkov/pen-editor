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
      className="ml-1 p-0.5 text-purple-400 hover:text-purple-300 flex-shrink-0"
      title="Reset to component value"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path
          d="M2 6a4 4 0 107.5-2M9.5 1v3h-3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
