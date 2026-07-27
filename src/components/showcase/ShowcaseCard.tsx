import type { ShowcaseScreen } from "@/lib/showcase";

export function ShowcaseCard({
  screen,
  onSelect,
}: {
  screen: ShowcaseScreen;
  onSelect: (screen: ShowcaseScreen) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(screen)}
      className="mb-4 block w-full break-inside-avoid overflow-hidden rounded-lg bg-surface-panel text-left ring-1 ring-border-default transition-colors hover:ring-border-hover"
    >
      <div
        className="w-full bg-surface-elevated"
        style={{ aspectRatio: `${screen.width} / ${screen.height}` }}
      >
        <img
          src={screen.imageUrl}
          alt={screen.title}
          loading="lazy"
          className="size-full object-cover object-top"
        />
      </div>
      <div className="p-2.5">
        <p className="truncate text-xs font-medium text-text-primary">
          {screen.title}
        </p>
        <p className="truncate text-[11px] text-text-muted">
          {screen.theme} · {screen.model}
        </p>
      </div>
    </button>
  );
}
