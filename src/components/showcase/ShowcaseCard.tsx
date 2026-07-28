import type { ShowcaseScreen } from "@/lib/showcase";

export type ShowcaseCopyFeedback = "success" | "error";

interface ShowcaseCardProps {
  screen: ShowcaseScreen;
  /** Called on a real (non-drag) click. Owner holds the clipboard logic. */
  onCopyId: (screen: ShowcaseScreen) => void;
  /** Transient result of the last copy attempt for this specific card. */
  feedback?: ShowcaseCopyFeedback | null;
}

// The whole screen is a button so clicking it copies `screen.id` to the
// clipboard (for `showcase:pin -- --screen <uuid>`) — see
// ShowcaseAppCarousel, which owns the clipboard call, the drag-vs-click
// distinction, and the feedback timer. No permanent caption/badge is added
// here on purpose: the showcase is a portfolio, the screenshots are the
// content, and `feedback` only renders for ~2s after a click.
// Every card uses the baseline phone-screen ratio. `object-cover object-top`
// keeps the top of a longer screen visible and clips its overflow at the
// bottom, so carousels and grid rows retain a consistent size.
export function ShowcaseCard({ screen, onCopyId, feedback }: ShowcaseCardProps) {
  return (
    <div
      data-slot="showcase-card"
      className="relative aspect-[390/844] w-full overflow-hidden rounded-3xl border border-gray-200 bg-surface-elevated"
    >
      <button
        type="button"
        onClick={() => onCopyId(screen)}
        aria-label={`Copy screen id: ${screen.title}`}
        className="block size-full cursor-pointer"
      >
        <img
          src={screen.imageUrl}
          alt={screen.title}
          loading="lazy"
          className="size-full object-cover object-top"
        />
      </button>

      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-x-3 bottom-3 rounded-full bg-surface-active/90 px-3 py-1.5 text-center text-xs font-medium text-white backdrop-blur-sm"
        >
          {feedback === "success" ? "ID copied" : "Couldn't copy"}
        </div>
      )}
    </div>
  );
}
