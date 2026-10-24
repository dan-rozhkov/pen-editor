import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type ForwardRefExoticComponent,
  type ReactNode,
  type RefAttributes,
  type SVGProps,
} from "react";

// The editor's own icon set (replaces @phosphor-icons/react). The API mirrors
// Phosphor's on purpose — `size`, `color`, `weight`, `mirrored`, `alt` and an
// `IconContext` provider — so call sites only had to change their import.
//
// Style, after Cursor's icon system: every glyph is drawn on a 16×16 grid as
// strokes with round caps and joins, at a fixed 1.25px screen stroke. The
// stroke does not scale with the icon (`vector-effect: non-scaling-stroke`,
// set for `[data-pen-icon]` in index.css), so a 12px and a 20px icon read as
// the same weight; at 22px and up it steps to 1.5px. Rules for drawing new
// glyphs: src/components/icons/STYLE.md.

export type IconWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  alt?: string;
  color?: string;
  size?: string | number;
  weight?: IconWeight;
  mirrored?: boolean;
}

export type Icon = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;

export const IconContext = createContext<IconProps>({
  color: "currentColor",
  size: "1em",
  weight: "regular",
  mirrored: false,
});

/**
 * Screen-pixel stroke for each weight. One weight is the point of the style,
 * so `light` and `regular` (the two the app used to mix) deliberately match;
 * only `thin` and `bold` differ.
 */
const STROKE: Record<IconWeight, number> = {
  thin: 1,
  light: 1.25,
  regular: 1.25,
  bold: 1.5,
  fill: 1.25,
  duotone: 1.25,
};

/** Glyph content: plain JSX, or a function of a per-instance id for masks. */
export type Glyph = ReactNode | ((uid: string) => ReactNode);

/**
 * Build an icon component. `outline` is stroked (fill none) on the 16 grid;
 * `fill`, when given, is the solid variant used for `weight="fill"` — painted
 * with fill and no stroke by default, details cut out with evenodd or a mask
 * keyed by `uid`. Icons without a fill variant fall back to the outline.
 */
export function createIcon(name: string, outline: Glyph, fill?: Glyph): Icon {
  const Component = forwardRef<SVGSVGElement, IconProps>(function PenIcon(props, ref) {
    const ctx = useContext(IconContext);
    const {
      alt,
      color = ctx.color ?? "currentColor",
      size = ctx.size ?? "1em",
      weight = ctx.weight ?? "regular",
      mirrored = ctx.mirrored ?? false,
      children,
      ...rest
    } = props;
    const rawId = useId();
    const solid = weight === "fill" && fill !== undefined;
    const glyph = solid ? fill : outline;
    const stroke = STROKE[weight] + (typeof size === "number" && size >= 22 ? 0.25 : 0);
    // `color` goes on the svg's own `color`, so dots and fill-variant rims
    // drawn with `currentColor` take it too, not just the root fill/stroke.
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 16 16"
        data-pen-icon={name}
        data-weight={weight}
        color={color === "currentColor" ? undefined : color}
        fill={solid ? "currentColor" : "none"}
        stroke={solid ? "none" : "currentColor"}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={mirrored ? "scale(-1, 1)" : undefined}
        {...rest}
      >
        {alt ? <title>{alt}</title> : null}
        {children}
        {typeof glyph === "function" ? glyph(rawId.replace(/:/g, "")) : glyph}
      </svg>
    );
  });
  Component.displayName = `${name}Icon`;
  return Component;
}
