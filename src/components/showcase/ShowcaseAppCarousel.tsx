import { useCallback, useEffect, useState } from "react";

import {
  type CarouselApi,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { ShowcaseCard, type ShowcaseCopyFeedback } from "@/components/showcase/ShowcaseCard";
import {
  getShowcaseModelLabel,
  type ShowcaseApp,
} from "@/components/showcase/showcaseApps";
import { accumulateWindow, getInitialWindow } from "@/components/showcase/carouselWindow";
import type { ShowcaseScreen } from "@/lib/showcase";
import { writeTextToClipboard } from "@/utils/clipboard";

const COPY_FEEDBACK_DURATION_MS = 2000;

interface ShowcaseAppCarouselProps {
  app: ShowcaseApp;
  /**
   * The first carousel in the grid gets its first slide loaded eagerly
   * (fetchPriority="high" + loading="eager") — it's the one screen that's
   * guaranteed above-the-fold.
   */
  isFirstInGrid?: boolean;
}

export function ShowcaseAppCarousel({ app, isFirstInGrid = false }: ShowcaseAppCarouselProps) {
  const hasMultipleScreens = app.screens.length > 1;
  const [api, setApi] = useState<CarouselApi>();
  const [selectedIndex, setSelectedIndex] = useState(0);

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

  // Embla itself swallows the native `click` event that would otherwise fire
  // on mouseup/touchend once a drag has crossed its distance threshold (see
  // embla-carousel's DragHandler: it calls stopPropagation/preventDefault on
  // a capture-phase `click` listener attached to the carousel root, above
  // every slide button). So a real drag never reaches this handler at all —
  // there is nothing extra to guard here, and no `clickAllowed()`-style
  // method exists on this Embla version's public API to call defensively.
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

  const onSelect = useCallback((carouselApi: NonNullable<CarouselApi>) => {
    setSelectedIndex(carouselApi.selectedScrollSnap());
  }, []);

  useEffect(() => {
    if (!api) return;

    api.on("select", onSelect);
    api.on("reInit", onSelect);
    // Prime selectedIndex for the current api instead of calling onSelect(api)
    // synchronously here: Embla's own emit() re-runs the just-registered
    // "select" listener, so the state update happens inside that callback
    // (the pattern react-hooks/set-state-in-effect asks for) rather than
    // directly in the effect body.
    api.emit("select");

    return () => {
      api.off("select", onSelect);
      api.off("reInit", onSelect);
    };
  }, [api, onSelect]);

  useEffect(() => {
    if (!api) return;

    const updateSlideOpacity = () => {
      const content = api.rootNode().querySelector<HTMLElement>(
        '[data-slot="carousel-content"]',
      );
      const viewport = content?.parentElement;

      if (!viewport) return;

      const viewportRect = viewport.getBoundingClientRect();
      if (!viewportRect.width) return;

      api.slideNodes().forEach((slide) => {
        const distanceFromViewport = Math.abs(
          slide.getBoundingClientRect().left - viewportRect.left,
        );
        const opacity = Math.max(0, 1 - distanceFromViewport / viewportRect.width);

        slide.style.opacity = opacity.toFixed(3);
      });
    };

    updateSlideOpacity();
    api.on("scroll", updateSlideOpacity);
    api.on("reInit", updateSlideOpacity);

    return () => {
      api.off("scroll", updateSlideOpacity);
      api.off("reInit", updateSlideOpacity);
    };
  }, [api]);

  return (
    <div
      data-slot="showcase-app-carousel"
      className="group/carousel relative overflow-hidden rounded-[2rem] bg-surface-base px-12 py-10 sm:px-16 sm:py-12"
    >
      <Carousel
        opts={{ loop: hasMultipleScreens, duration: 20 }}
        setApi={setApi}
        data-transition="fade-slide"
        className="[&>div:first-child]:overflow-visible"
        aria-label={`${app.screens[0].title} screens`}
      >
        <CarouselContent className="ml-0">
          {app.screens.map((screen, index) => (
            <CarouselItem
              key={screen.id}
              className="pl-0 will-change-opacity"
              aria-label={`Screen ${index + 1} of ${app.screens.length}`}
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
              />
            </CarouselItem>
          ))}
        </CarouselContent>

        {hasMultipleScreens && (
          <>
            <CarouselPrevious className="-left-[2.75rem] size-10 border-transparent bg-surface-active/80 text-white shadow-none opacity-0 pointer-events-none backdrop-blur-sm transition-[opacity,background-color] group-hover/carousel:pointer-events-auto group-hover/carousel:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:bg-surface-active/90 hover:text-white sm:-left-[3.25rem]" />
            <CarouselNext className="-right-[2.75rem] size-10 border-transparent bg-surface-active/80 text-white shadow-none opacity-0 pointer-events-none backdrop-blur-sm transition-[opacity,background-color] group-hover/carousel:pointer-events-auto group-hover/carousel:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:bg-surface-active/90 hover:text-white sm:-right-[3.25rem]" />
          </>
        )}
      </Carousel>

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
              onClick={() => api?.scrollTo(index)}
            />
          ))}
        </div>
      )}

      <span className="absolute bottom-3 left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2 truncate text-center text-xs font-normal text-text-muted sm:bottom-4">
        {getShowcaseModelLabel(app.screens[0].model)}
      </span>
    </div>
  );
}
