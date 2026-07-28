import { useCallback, useEffect, useState } from "react";

import {
  type CarouselApi,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { ShowcaseCard } from "@/components/showcase/ShowcaseCard";
import type { ShowcaseApp } from "@/components/showcase/showcaseApps";

export function ShowcaseAppCarousel({ app }: { app: ShowcaseApp }) {
  const hasMultipleScreens = app.screens.length > 1;
  const [api, setApi] = useState<CarouselApi>();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const onSelect = useCallback((carouselApi: NonNullable<CarouselApi>) => {
    setSelectedIndex(carouselApi.selectedScrollSnap());
  }, []);

  useEffect(() => {
    if (!api) return;

    onSelect(api);
    api.on("select", onSelect);
    api.on("reInit", onSelect);

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
              <ShowcaseCard screen={screen} />
            </CarouselItem>
          ))}
        </CarouselContent>

        {hasMultipleScreens && (
          <>
            <CarouselPrevious className="-left-[2.75rem] size-10 border-transparent bg-surface-active/70 text-white shadow-none opacity-0 pointer-events-none backdrop-blur-sm transition-[opacity,background-color] group-hover/carousel:pointer-events-auto group-hover/carousel:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:bg-surface-active/85 hover:text-white sm:-left-[3.25rem]" />
            <CarouselNext className="-right-[2.75rem] size-10 border-transparent bg-surface-active/70 text-white shadow-none opacity-0 pointer-events-none backdrop-blur-sm transition-[opacity,background-color] group-hover/carousel:pointer-events-auto group-hover/carousel:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:bg-surface-active/85 hover:text-white sm:-right-[3.25rem]" />
          </>
        )}
      </Carousel>

      {hasMultipleScreens && (
        <div
          className="absolute top-5 right-5 flex gap-1.5 opacity-0 pointer-events-none transition-opacity group-hover/carousel:pointer-events-auto group-hover/carousel:opacity-100 group-focus-within/carousel:pointer-events-auto group-focus-within/carousel:opacity-100 sm:top-6 sm:right-6"
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
                  ? "bg-gray-900"
                  : "bg-gray-300 hover:bg-gray-500"
              }`}
              onClick={() => api?.scrollTo(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
