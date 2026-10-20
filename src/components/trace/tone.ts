import { CheckCircleIcon, CircleIcon, WarningCircleIcon, XCircleIcon, type Icon } from "@phosphor-icons/react";
import type { Tone } from "./traceModel";

/** Badge / chip colours per tone. Theme-aware: tinted fill, readable text in light and dark. */
export const TONE_BADGE: Record<Tone, string> = {
  success: "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  danger: "bg-destructive/10 text-destructive dark:bg-destructive/20",
  warning: "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
  neutral: "bg-secondary text-secondary-foreground",
};

/** Outcome icon and its colour per tone; the single source for the header badge and the QA panel. */
export const TONE_ICON: Record<Tone, { Icon: Icon; className: string }> = {
  danger: { Icon: XCircleIcon, className: "text-destructive" },
  success: { Icon: CheckCircleIcon, className: "text-emerald-600 dark:text-emerald-400" },
  warning: { Icon: WarningCircleIcon, className: "text-amber-600 dark:text-amber-400" },
  neutral: { Icon: CircleIcon, className: "text-text-muted" },
};
