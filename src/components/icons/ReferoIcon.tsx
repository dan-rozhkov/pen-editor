import { forwardRef } from "react";
import type { Icon, IconProps, IconWeight } from "@phosphor-icons/react";

// The Refero brand mark: a capital R inside a ring (the ® shape). Redrawn as
// an outline so it sits next to the Phosphor icons in the chat tool chips
// without looking like a pasted logo — same 256×256 viewBox and the same
// per-weight stroke widths Phosphor uses.
//
// Phosphor icons are filled paths tinted with `fill`; this one is stroked, so
// `color` is applied to `stroke` (and `fill` is forced to none) instead. Every
// other prop behaves as it does for a real Phosphor icon, which is why the
// component is typed as `Icon` and can live in `toolIcons`' map.
const STROKE_WIDTHS: Record<IconWeight, number> = {
  thin: 8,
  light: 12,
  regular: 16,
  bold: 24,
  fill: 28,
  duotone: 16,
};

export const ReferoIcon: Icon = forwardRef<SVGSVGElement, IconProps>(
  function ReferoIcon(
    { alt, color = "currentColor", size = 16, weight = "regular", mirrored, ...rest },
    ref,
  ) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 256 256"
        fill="none"
        stroke={color}
        strokeWidth={STROKE_WIDTHS[weight]}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={mirrored ? "scale(-1, 1)" : undefined}
        {...rest}
      >
        {!!alt && <title>{alt}</title>}
        {weight === "duotone" && (
          <circle cx="128" cy="128" r="96" fill={color} opacity="0.2" stroke="none" />
        )}
        <circle cx="128" cy="128" r="96" />
        {/* Stem, shoulder and bowl of the R, then its leg. */}
        <path d="M100,180 L100,76 L140,76 a26,26 0 0 1 0,52 L100,128" />
        <path d="M134,128 L162,180" />
      </svg>
    );
  },
);
