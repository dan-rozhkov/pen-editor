import type { Tone } from "./traceModel";

/** Badge / chip colours per tone. Theme-aware: tinted fill, readable text in light and dark. */
export const TONE_BADGE: Record<Tone, string> = {
  success: "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  danger: "bg-destructive/10 text-destructive dark:bg-destructive/20",
  warning: "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
  neutral: "bg-secondary text-secondary-foreground",
};
