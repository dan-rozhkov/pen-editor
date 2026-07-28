import { useCallback, useState } from "react";

import type { ShowcaseScreen } from "@/lib/showcase";

export type ShowcaseCopyFeedback = "success" | "error";

// Derived from the actual geometry, not eyeballed vw fractions — those
// undercounted the two *fixed* paddings that dominate at this card size and
// overstated the card by 1.7-2.4x, which was enough to make retina desktop
// fetch the 750w source when the card only ever renders at ~148px there.
//
// - `<main>` (ShowcasePage): `px-12 sm:px-16` → 48px/64px *per side*.
// - `ShowcaseGrid`: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`
//   with `gap-4` (16px) between cells.
// - `ShowcaseAppCarousel` (the direct parent of `ShowcaseCard`, inside each
//   grid cell): `px-12 sm:px-16` again → another 48px/64px *per side*
//   around the image itself.
//
// card width = (100vw - 2×mainPad - (cols-1)×gap) / cols - 2×carouselPad
//
//   xl (>=1280, 4 cols, sm padding 64 both sides):
//     (100vw - 128 - 3×16) / 4 - 128 = (100vw - 176)/4 - 128
//   lg (>=1024, 3 cols, sm padding):
//     (100vw - 128 - 2×16) / 3 - 128 = (100vw - 160)/3 - 128
//   sm (>=640, 2 cols, sm padding):
//     (100vw - 128 - 1×16) / 2 - 128 = (100vw - 144)/2 - 128
//   base (<640, 1 col, base padding 48 both sides, no gap):
//     100vw - 96 - 96 = 100vw - 192
const SHOWCASE_IMAGE_SIZES = [
  "(min-width:1280px) calc((100vw - 176px)/4 - 128px)",
  "(min-width:1024px) calc((100vw - 160px)/3 - 128px)",
  "(min-width:640px) calc((100vw - 144px)/2 - 128px)",
  "calc(100vw - 192px)",
].join(", ");

interface ShowcaseCardProps {
  screen: ShowcaseScreen;
  /** Called on a real (non-drag) click. Owner holds the clipboard logic. */
  onCopyId: (screen: ShowcaseScreen) => void;
  /** Transient result of the last copy attempt for this specific card. */
  feedback?: ShowcaseCopyFeedback | null;
  /** fetchPriority="high" + loading="eager" for the one above-the-fold card. */
  eager?: boolean;
  /**
   * Whether to actually mount the <img>. False renders just the same-sized
   * box painted with the LQIP (or nothing, pre-backfill) — used by
   * ShowcaseAppCarousel for slides outside the selected ±1 window, since
   * overlapping carousel slides sit inside the viewport and defeat
   * loading="lazy" on their own.
   */
  loadImage?: boolean;
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
export function ShowcaseCard({
  screen,
  onCopyId,
  feedback,
  eager = false,
  loadImage = true,
}: ShowcaseCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  // `onLoad` never fires for an image the browser had already fully decoded
  // before this node was inserted (e.g. a same-URL slide revisited after
  // ShowcaseAppCarousel's monotonic mounting kept it around, or a plain
  // browser-cache hit) — `complete` is already `true` by the time React
  // hands us the node, and no further `load` event follows. The ref
  // callback catches that at mount; `onLoad` still covers the normal
  // not-yet-loaded case.
  const handleImageRef = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete) {
      setImageLoaded(true);
    }
  }, []);
  // Paint the LQIP as long as the real image hasn't finished loading (or
  // isn't being loaded at all) — this is what actually covers Timeweb's
  // multi-second TTFB, since the placeholder ships inline in the feed JSON
  // and paints before any image request even starts.
  const showLqip = !!screen.lqip && (!loadImage || !imageLoaded);

  return (
    <div
      data-slot="showcase-card"
      className="relative aspect-[390/844] w-full overflow-hidden rounded-3xl border border-gray-200 bg-surface-elevated bg-cover bg-top"
      style={showLqip ? { backgroundImage: `url(${screen.lqip})` } : undefined}
    >
      <button
        type="button"
        onClick={() => onCopyId(screen)}
        aria-label={`Copy screen id: ${screen.title}`}
        className="block size-full cursor-pointer"
      >
        {loadImage && (
          <img
            ref={handleImageRef}
            src={screen.imageUrl}
            // Descriptors are built from the real screen dimensions rather
            // than hardcoded 375w/750w: hand-authored runs (showcase-hand-run)
            // publish at 780x1688, not the generated pipeline's 750x1624 —
            // baking in the wrong width would have the browser picking the
            // wrong source by ~4%.
            srcSet={
              screen.imageUrl1x
                ? `${screen.imageUrl1x} ${Math.round(screen.width / 2)}w, ${screen.imageUrl} ${screen.width}w`
                : undefined
            }
            sizes={screen.imageUrl1x ? SHOWCASE_IMAGE_SIZES : undefined}
            alt={screen.title}
            loading={eager ? "eager" : "lazy"}
            fetchPriority={eager ? "high" : undefined}
            onLoad={() => setImageLoaded(true)}
            className="size-full object-cover object-top"
          />
        )}
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
