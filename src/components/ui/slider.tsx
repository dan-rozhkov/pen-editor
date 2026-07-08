"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "@/lib/utils";

type SliderProps = Omit<SliderPrimitive.Root.Props<number | readonly number[]>, "children"> & {
  controlClassName?: string;
  indicatorClassName?: string;
  thumbClassName?: string;
  trackClassName?: string;
  getAriaLabel?: SliderPrimitive.Thumb.Props["getAriaLabel"];
};

function Slider({
  className,
  controlClassName,
  indicatorClassName,
  thumbClassName,
  trackClassName,
  getAriaLabel,
  thumbAlignment = "center",
  value,
  defaultValue,
  ...props
}: SliderProps) {
  const thumbCount = Array.isArray(value)
    ? value.length
    : Array.isArray(defaultValue)
      ? defaultValue.length
      : 1;

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      thumbAlignment={thumbAlignment}
      value={value}
      defaultValue={defaultValue}
      className={cn(
        "group/slider relative flex w-full touch-none select-none items-center data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Control
        data-slot="slider-control"
        className={cn("relative flex h-4 w-full items-center", controlClassName)}
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn("relative h-1 w-full overflow-hidden rounded-full bg-secondary", trackClassName)}
        >
          <SliderPrimitive.Indicator
            data-slot="slider-indicator"
            className={cn("h-full rounded-full bg-accent-primary", indicatorClassName)}
          />
        </SliderPrimitive.Track>
        {Array.from({ length: thumbCount }).map((_, index) => (
          <SliderPrimitive.Thumb
            key={index}
            data-slot="slider-thumb"
            index={index}
            getAriaLabel={getAriaLabel}
            className={cn(
              "block size-3 rounded-full border border-accent-primary bg-surface-panel shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-accent-selection focus-visible:outline-none data-dragging:bg-surface-elevated",
              thumbClassName,
            )}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
