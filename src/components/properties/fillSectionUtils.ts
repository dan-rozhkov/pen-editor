import type {
  Effect,
  GradientType,
  Paint,
  ShadowEffect,
} from "@/types/scene";
import {
  createGradientPaint,
  createImagePaint,
  createSolidPaint,
} from "@/utils/fillUtils";
import { getDefaultGradient } from "@/utils/gradientUtils";

/** Discrete fill kinds shown in the per-paint type selector. */
export type FillKind = "solid" | "linear" | "radial" | "image";

/** Map a Paint to its UI fill kind. */
export function getFillKind(paint: Paint): FillKind {
  switch (paint.type) {
    case "solid":
      return "solid";
    case "image":
      return "image";
    case "gradient":
      return paint.gradient.type;
  }
}

/**
 * The common per-paint properties preserved when converting between paint
 * kinds (id, visibility, opacity, blend mode).
 */
function paintMeta(paint: Paint): Pick<Paint, "id" | "visible" | "opacity" | "blendMode"> {
  return {
    id: paint.id,
    visible: paint.visible,
    opacity: paint.opacity,
    blendMode: paint.blendMode,
  };
}

/** Pull a representative solid color out of any paint, for type conversions. */
function representativeColor(paint: Paint): string {
  if (paint.type === "solid") return paint.color;
  if (paint.type === "gradient") return paint.gradient.stops[0]?.color ?? "#cccccc";
  return "#cccccc";
}

/**
 * Append a new solid paint to the top of the stack (last element renders on
 * top). Default color matches Figma's "add fill" behaviour.
 */
export function addSolidFill(fills: Paint[], color = "#cccccc"): Paint[] {
  return [...fills, createSolidPaint(color)];
}

/** Remove the paint at array index `index`. */
export function removeFillAt(fills: Paint[], index: number): Paint[] {
  return fills.filter((_, i) => i !== index);
}

/** Replace the paint at array index `index` with `next`, preserving order. */
export function updateFillAt(fills: Paint[], index: number, next: Paint): Paint[] {
  return fills.map((p, i) => (i === index ? next : p));
}

/** Toggle the `visible` flag of the paint at `index`. */
export function toggleFillVisibleAt(fills: Paint[], index: number): Paint[] {
  return fills.map((p, i) =>
    i === index ? { ...p, visible: p.visible === false } : p,
  );
}

/**
 * Move the item at `index` by `delta` positions in the array. `delta` is in
 * array space (positive = toward the top of the stack / end of array).
 * Out-of-range moves are clamped to a no-op. Shared by the fill and effect
 * stacks (both render bottom-to-top and reorder the same way).
 */
export function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length || index < 0 || index >= items.length) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * Convert the paint at `index` to a different fill kind, preserving per-paint
 * metadata (id/visible/opacity/blendMode). Gradient conversions keep the
 * current color as the first stop; switching between linear/radial keeps the
 * existing stops.
 */
export function convertFillKind(fills: Paint[], index: number, kind: FillKind): Paint[] {
  const current = fills[index];
  if (!current) return fills;
  if (getFillKind(current) === kind) return fills;

  const meta = paintMeta(current);
  let next: Paint;

  if (kind === "solid") {
    next = { ...createSolidPaint(representativeColor(current)), ...meta };
  } else if (kind === "image") {
    const image =
      current.type === "image" ? current.image : { url: "", mode: "fill" as const };
    next = { ...createImagePaint(image), ...meta };
  } else {
    // linear | radial
    const gradientType = kind as GradientType;
    if (current.type === "gradient") {
      // Reuse existing stops, swap geometry to the requested gradient type.
      next = {
        ...createGradientPaint({
          ...getDefaultGradient(gradientType),
          stops: current.gradient.stops,
        }),
        ...meta,
      };
    } else {
      const base = getDefaultGradient(gradientType);
      base.stops = [
        { color: representativeColor(current), position: 0 },
        { color: "#000000", position: 1 },
      ];
      next = { ...createGradientPaint(base), ...meta };
    }
  }

  return updateFillAt(fills, index, next);
}

// --- Effects ---

/** Append a new shadow effect to the top of the stack. */
export function addEffect(effects: Effect[], effect: ShadowEffect): Effect[] {
  return [...effects, effect];
}

/** Remove the effect at array index `index`. */
export function removeEffectAt(effects: Effect[], index: number): Effect[] {
  return effects.filter((_, i) => i !== index);
}

/** Replace the effect at array index `index` with `next`. */
export function updateEffectAt(effects: Effect[], index: number, next: Effect): Effect[] {
  return effects.map((e, i) => (i === index ? next : e));
}

/** Toggle the `visible` flag of the effect at `index`. */
export function toggleEffectVisibleAt(effects: Effect[], index: number): Effect[] {
  return effects.map((e, i) =>
    i === index ? { ...e, visible: e.visible === false } : e,
  );
}
