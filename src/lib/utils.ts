import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// `rounded-control*` radii (src/index.css @theme) must merge like any other
// `rounded-*` utility, so a className override replaces the primitive's default.
const twMerge = extendTailwindMerge<"control-surface">({
  extend: {
    theme: {
      radius: ["control", "control-xs", "control-sm", "control-lg", "control-xl", "control-inset"],
    },
    // `control-raised` / `control-elevation` (src/index.css @utility) replace
    // each other (later wins) and conflict with nothing else, so a variant's
    // fill (`bg-*`) or `shadow-*` override cannot drop them.
    classGroups: {
      "control-surface": ["control-raised", "control-elevation"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** True for a non-null, non-array object: the shape guard for untrusted JSON. */
export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
