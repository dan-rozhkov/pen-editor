import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { ShowcaseCard, type ShowcaseCopyFeedback } from "@/components/showcase/ShowcaseCard";
import { getShowcaseModelLabel } from "@/components/showcase/showcaseApps";
import { accumulateWindow, getInitialWindow } from "@/components/showcase/carouselWindow";
import type { ShowcaseApp, ShowcaseScreen } from "@/lib/showcase";
import { cn } from "@/lib/utils";
import { writeTextToClipboard } from "@/utils/clipboard";

const COPY_FEEDBACK_DURATION_MS = 2000;

// One stride is the distance between two neighbouring snap points — the item
// width plus the scroller's column gap — measured from the DOM rather than
// assumed, so it stays right across the `sm:` padding breakpoint and any
// viewport width. Arrow clicks scroll by it, and the fade normalizes by it,
// so a slide reaches opacity 0 exactly as the next one lands centred.
function measureItemStride(items: (HTMLLIElement | null)[]): number {
  const first = items[0];
  if (!first) return 0;
  const second = items[1];
  if (second) {
    return second.getBoundingClientRect().left - first.getBoundingClientRect().left;
  }
  return first.getBoundingClientRect().width;
}

interface ShowcaseAppCarouselProps {
  app: ShowcaseApp;
  /**
   * The first carousel in the grid gets its first slide loaded eagerly
   * (fetchPriority="high" + loading="eager") — it's the one screen that's
   * guaranteed above-the-fold.
   */
  isFirstInGrid?: boolean;
}

// Mobbin's own scroller (discover/apps/ios/latest) is a plain
// `<ol class="… snap-x snap-mandatory overflow-x-auto overflow-y-hidden …">`
// — no JS carousel library, no drag handler, no wheel handler. `overflow-y:
// hidden` is what makes a vertical wheel/trackpad gesture over a card scroll
// the PAGE instead of getting hijacked; native scroll-snap does the rest
// (centering, smooth landing). We replicate that structure exactly and only
// add what Mobbin doesn't need: hover arrows and selector dots, because a
// plain-mouse user has no horizontal-scroll gesture at all.
export function ShowcaseAppCarousel({ app, isFirstInGrid = false }: ShowcaseAppCarouselProps) {
  const hasMultipleScreens = app.screens.length > 1;
  const scrollerRef = useRef<HTMLOListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(hasMultipleScreens);

  // Identifies "this app's slide set" so the accumulated window below can
  // be reset if it ever changes under an existing instance. ShowcasePage
  // keys carousels by `runId`, so normally a different app is a whole new
  // component instance with fresh state for free — this guards the case
  // where the same runId's screens list changes shape in place (e.g. a
  // background refetch), which the `runId` key alone wouldn't catch.
  const screensKey = app.screens.map((screen) => screen.id).join("|");
  const currentWindow = getInitialWindow(app.screens.length, selectedIndex);

  // Mirrors React's "adjusting state when a prop changes" pattern: reading
  // and conditionally calling a setter during render (rather than mutating
  // a ref) is what react-hooks/refs and Fast Refresh both require here.
  // React re-renders immediately with the updated state before committing,
  // so `loadedIndices` below always reflects the value computed in this
  // pass.
  const [mountedScreensKey, setMountedScreensKey] = useState(screensKey);
  const [mountedIndices, setMountedIndices] = useState(currentWindow);

  let loadedIndices = mountedIndices;
  if (mountedScreensKey !== screensKey) {
    setMountedScreensKey(screensKey);
    setMountedIndices(currentWindow);
    loadedIndices = currentWindow;
  } else {
    const nextIndices = accumulateWindow(mountedIndices, currentWindow);
    if (nextIndices !== mountedIndices) {
      setMountedIndices(nextIndices);
    }
    loadedIndices = nextIndices;
  }

  const [copyFeedback, setCopyFeedback] = useState<{
    screenId: string;
    status: ShowcaseCopyFeedback;
  } | null>(null);

  const handleCopyScreenId = useCallback((screen: ShowcaseScreen) => {
    void writeTextToClipboard(screen.id).then((copied) => {
      setCopyFeedback({ screenId: screen.id, status: copied ? "success" : "error" });
    });
  }, []);

  useEffect(() => {
    if (!copyFeedback) return;

    const timeout = setTimeout(() => setCopyFeedback(null), COPY_FEEDBACK_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [copyFeedback]);

  // Track which screen is centred by watching scroll position, rather than
  // an IntersectionObserver, so the same math drives both "which dot is lit"
  // and "can prev/next still move" from one measurement pass. Throttled to
  // one measurement per animation frame; the rAF handle is cleared on
  // scroll-away and on unmount so nothing runs after teardown.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    let rafId: number | null = null;

    const measure = () => {
      rafId = null;
      const scrollerRect = scroller.getBoundingClientRect();
      if (!scrollerRect.width) return;
      const scrollerCenter = scrollerRect.left + scrollerRect.width / 2;

      const stride = measureItemStride(itemRefs.current);

      let closestIndex = 0;
      let closestDistance = Infinity;
      itemRefs.current.forEach((item, index) => {
        if (!item) return;
        const itemRect = item.getBoundingClientRect();
        if (!itemRect.width) return;
        const itemCenter = itemRect.left + itemRect.width / 2;
        const distance = Math.abs(itemCenter - scrollerCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }

        // Mobbin fades its off-centre slides rather than letting them sit
        // hard-clipped at the scroller's edges, and the peek reads as a hint
        // of the next screen instead of a cropped one. Measured off the live
        // site: it writes an inline opacity per frame following exactly
        // `max(0, 1 - |offset| / stride)` — linear in the distance from the
        // centre, gone one stride out. Setting the style directly (rather
        // than through state) keeps this off React's render path; it runs on
        // every scroll frame.
        item.style.opacity = stride
          ? Math.max(0, 1 - distance / stride).toFixed(3)
          : "1";
      });

      setSelectedIndex(closestIndex);
      setCanScrollPrev(scroller.scrollLeft > 1);
      setCanScrollNext(
        scroller.scrollLeft < scroller.scrollWidth - scroller.clientWidth - 1,
      );
    };

    const onScroll = () => {
      if (rafId != null) return;
      rafId = requestAnimationFrame(measure);
    };

    measure();
    scroller.addEventListener("scroll", onScroll, { passive: true });

    // A `scroll` event alone is not enough to keep this state honest: resizing
    // the window (or rotating a phone) changes the item width and therefore
    // both the centred index and whether there is anything left to scroll to,
    // without ever firing `scroll`. Without this, the arrows and dots freeze
    // in whatever state the previous layout left them in.
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onScroll);
    resizeObserver?.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", onScroll);
      resizeObserver?.disconnect();
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [app.screens.length]);

  const getItemStride = useCallback(() => {
    if (!scrollerRef.current) return 0;
    return measureItemStride(itemRefs.current);
  }, []);

  const scrollByOffset = useCallback((direction: 1 | -1) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const stride = getItemStride();
    if (!stride) return;
    scroller.scrollBy({ left: direction * stride, behavior: "smooth" });
  }, [getItemStride]);

  const scrollToIndex = useCallback((index: number) => {
    const scroller = scrollerRef.current;
    const item = itemRefs.current[index];
    if (!scroller || !item) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const delta =
      itemRect.left + itemRect.width / 2 - (scrollerRect.left + scrollerRect.width / 2);
    scroller.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  return (
    <div
      data-slot="showcase-app-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label={`${app.screens[0].title} screens`}
      className="group/carousel relative overflow-hidden rounded-[2rem] bg-surface-base py-10 sm:py-12"
    >
      {/* `role="region"` lives on the panel, NOT on the <ol>: an explicit role
          on the list would replace its implicit `list` role, and an <li>
          requires a list parent to be a `listitem` at all. The <ol> keeps its
          own accessible name so the scroller is still addressable on its own. */}
      <ol
        ref={scrollerRef}
        aria-label={`${app.screens[0].title} screens`}
        className="scrollbar-none flex items-center gap-x-6 overflow-x-auto overflow-y-hidden overscroll-x-contain snap-x snap-mandatory scroll-smooth px-20 sm:px-16"
      >
        {app.screens.map((screen, index) => (
          <li
            key={screen.id}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            aria-label={`Screen ${index + 1} of ${app.screens.length}`}
            className="w-full shrink-0 snap-center snap-always"
          >
            <ShowcaseCard
              screen={screen}
              onCopyId={handleCopyScreenId}
              feedback={copyFeedback?.screenId === screen.id ? copyFeedback.status : null}
              // Only gate mounting on the window when there's an `lqip`
              // to show in its place — without one (pre-backfill rows,
              // or if the frontend ships before the backend backfill
              // finishes) an unmounted slide would be a blank rectangle
              // forever, not a placeholder. Load it eagerly instead, same
              // as before this feature existed.
              loadImage={!screen.lqip || loadedIndices.has(index)}
              eager={isFirstInGrid && index === 0}
              selected={index === selectedIndex}
            />
          </li>
        ))}
      </ol>

      {/* The arrows sit INSIDE the panel (left-1/right-1), not hanging off it
          with a negative offset as they did under Embla: the panel's own
          horizontal padding now lives on the scroller (that padding is what
          produces the peek), so anything positioned outside the panel box is
          clipped by its `overflow-hidden`. Verified in the browser — with the
          old negative offsets the arrows were invisible on hover.

          At the ends of the track an arrow is neither unmounted nor given the
          `disabled` attribute — it is marked `aria-disabled` and dimmed, and
          its handler no-ops. Embla looped, so neither arrow was ever spent and
          none of this came up. Unmounting the arrow you just clicked drops
          keyboard focus to <body> at exactly the moment a keyboard user
          reaches the last screen; the native `disabled` attribute is no better
          because `Button`'s own `disabled:opacity-50` outranks the `opacity-0`
          that keeps arrows hidden until hover, which left a dead arrow
          permanently visible on every card (both seen in the browser). Note
          the two `group-hover/carousel:opacity-*` classes below collide by
          design and are resolved by `cn`'s tailwind-merge, last one winning. */}
      {hasMultipleScreens && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Previous screen"
          aria-disabled={!canScrollPrev}
          onClick={() => canScrollPrev && scrollByOffset(-1)}
          className={cn(
            "absolute top-1/2 left-1 size-10 -translate-y-1/2 rounded-full border-transparent bg-surface-active/80 text-white opacity-0 shadow-none backdrop-blur-sm transition-[opacity,background-color] pointer-events-none group-hover/carousel:pointer-events-auto group-hover/carousel:opacity-100 hover:bg-surface-active/90 hover:text-white focus-visible:pointer-events-auto focus-visible:opacity-100 sm:left-3",
            !canScrollPrev && "cursor-default group-hover/carousel:opacity-30 hover:bg-surface-active/80",
          )}
        >
          <ArrowLeftIcon aria-hidden="true" weight="bold" />
          <span className="sr-only">Previous screen</span>
        </Button>
      )}

      {hasMultipleScreens && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Next screen"
          aria-disabled={!canScrollNext}
          onClick={() => canScrollNext && scrollByOffset(1)}
          className={cn(
            "absolute top-1/2 right-1 size-10 -translate-y-1/2 rounded-full border-transparent bg-surface-active/80 text-white opacity-0 shadow-none backdrop-blur-sm transition-[opacity,background-color] pointer-events-none group-hover/carousel:pointer-events-auto group-hover/carousel:opacity-100 hover:bg-surface-active/90 hover:text-white focus-visible:pointer-events-auto focus-visible:opacity-100 sm:right-3",
            !canScrollNext && "cursor-default group-hover/carousel:opacity-30 hover:bg-surface-active/80",
          )}
        >
          <ArrowRightIcon aria-hidden="true" weight="bold" />
          <span className="sr-only">Next screen</span>
        </Button>
      )}

      {hasMultipleScreens && (
        <div
          className="absolute top-5 right-5 flex gap-1.5 sm:top-6 sm:right-6"
          aria-label="Screen selector"
        >
          {app.screens.map((screen, index) => (
            <button
              key={screen.id}
              type="button"
              aria-label={`Go to screen ${index + 1}`}
              aria-current={selectedIndex === index ? "true" : undefined}
              className={`size-1.5 rounded-full transition-colors ${
                selectedIndex === index
                  ? "bg-text-primary"
                  : "bg-surface-active hover:bg-border-hover"
              }`}
              onClick={() => scrollToIndex(index)}
            />
          ))}
        </div>
      )}

      <span className="absolute bottom-3 left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2 truncate text-center text-xs font-normal text-text-muted sm:bottom-4">
        {getShowcaseModelLabel(app.model)}
      </span>
    </div>
  );
}
