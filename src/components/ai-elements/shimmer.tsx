import { type CSSProperties, type ElementType, memo, useMemo } from "react";
import { cn } from "@/lib/utils";

export type ShimmerProps = {
  children: string;
  as?: ElementType;
  className?: string;
  /** Seconds for one sweep across the text. */
  duration?: number;
  /** Highlight width per character, in px. */
  spread?: number;
};

// Port of AI SDK Elements' Shimmer (elements.ai-sdk.dev/components/shimmer):
// a bright band travels across the text by animating the position of a
// background gradient that is clipped to the glyphs. The upstream component
// drives that with `motion/react`; this project has no motion dependency, so
// the same animation runs as a plain CSS keyframe (`--animate-shimmer` in
// index.css), which also lets `prefers-reduced-motion` switch it off.
//
// Colors come from project tokens and can be overridden per call site with
// `--shimmer-base` / `--shimmer-highlight`.
const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: ShimmerProps) => {
  // Longer labels get a proportionally wider highlight, so the sweep reads at
  // the same speed regardless of text length (upstream behaviour).
  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread]
  );

  return (
    <Component
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[background-repeat:no-repeat,padding-box]",
        "animate-shimmer motion-reduce:animate-none",
        className
      )}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          "--shimmer-duration": `${duration}s`,
          backgroundImage:
            "linear-gradient(90deg,#0000 calc(50% - var(--spread)),var(--shimmer-highlight,var(--color-text-primary)),#0000 calc(50% + var(--spread)))," +
            "linear-gradient(var(--shimmer-base,var(--color-text-muted)),var(--shimmer-base,var(--color-text-muted)))",
        } as CSSProperties
      }
    >
      {children}
    </Component>
  );
};

export const Shimmer = memo(ShimmerComponent);
