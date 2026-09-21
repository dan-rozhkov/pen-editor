// Pure helpers for ContextMeter (components/chat/ContextMeter.tsx) — kept
// separate from the component so the percent/format math is unit-testable
// without rendering.

/** `tokens` as a percentage of `contextWindow`, clamped to [0, 100] and
 * rounded to the nearest whole percent. A turn's actual input tokens can
 * exceed the window it was measured against (the backend trims context
 * between turns, so a reading can lag a since-grown window) — clamp rather
 * than let the arc overshoot past a full circle. */
export function contextFillPercent(tokens: number, contextWindow: number): number {
  if (contextWindow <= 0 || tokens <= 0) return 0;
  const percent = (tokens / contextWindow) * 100;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

/** Compact K/M token formatting, e.g. 128000 -> "128K", 1048576 -> "1M". One
 * decimal place, trimmed when it's a trailing zero. */
export function formatCompactTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    return `${trimTrailingZero((n / 1_000_000).toFixed(1))}M`;
  }
  if (abs >= 1_000) {
    return `${trimTrailingZero((n / 1_000).toFixed(1))}K`;
  }
  return String(Math.round(n));
}

function trimTrailingZero(s: string): string {
  return s.replace(/\.0$/, "");
}

/** "128K / 1M" — the compact fraction shown in ContextMeter's tooltip. */
export function formatContextUsage(tokens: number, contextWindow: number): string {
  return `${formatCompactTokens(tokens)} / ${formatCompactTokens(contextWindow)}`;
}

/** The full tooltip/aria-label text: "Context: 12% · 128K / 1M". */
export function contextMeterLabel(tokens: number, contextWindow: number): string {
  return `Context: ${contextFillPercent(tokens, contextWindow)}% · ${formatContextUsage(tokens, contextWindow)}`;
}
