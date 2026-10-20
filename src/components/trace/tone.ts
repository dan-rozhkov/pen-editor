import { CheckCircleIcon, CircleIcon, WarningCircleIcon, XCircleIcon, type Icon } from "@phosphor-icons/react";
import type { Tone } from "./traceModel";

/** Outcome icon and its colour per tone; rendered by `ToneIcon`. */
export const TONE_ICON: Record<Tone, { Icon: Icon; className: string }> = {
  danger: { Icon: XCircleIcon, className: "text-destructive" },
  success: { Icon: CheckCircleIcon, className: "text-emerald-600 dark:text-emerald-400" },
  warning: { Icon: WarningCircleIcon, className: "text-amber-600 dark:text-amber-400" },
  neutral: { Icon: CircleIcon, className: "text-text-muted" },
};
