import { createIcon } from "@/components/icons";

/**
 * Text-on-path tool: a wave with a "T" standing on its end, tilted along the
 * path (the same idea as the original artwork, which was a filled 60×55
 * drawing much heavier than its neighbours). Drawn on the set's 16 grid
 * through `createIcon`, so it takes the shared non-scaling stroke.
 */
export const TextOnPathIcon = /*#__PURE__*/ createIcon(
  "TextOnPath",
  <>
    <path d="M1.75 13.5c1.5-3 3.25-3.5 5-2s3.5 1.25 4.75-1.75" />
    <path d="M8.5 1.75l5.75 2.1M11.4 2.8 10 6.6" />
  </>,
);
