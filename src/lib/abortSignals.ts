/**
 * Combines abort signals (undefined ones are skipped) so a fetch aborts on whichever fires first.
 * `AbortSignal.any` is the standard combinator (Node 20+ / all evergreen browsers); the manual fallback
 * only matters for a runtime old enough to lack it. At least one signal is needed.
 */
export function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const list = signals.filter((s): s is AbortSignal => s !== undefined);
  if (list.length === 1) return list[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(list);
  const aborted = list.find((s) => s.aborted);
  if (aborted) return aborted;
  const controller = new AbortController();
  for (const source of list) source.addEventListener("abort", () => controller.abort(source.reason), { once: true });
  return controller.signal;
}
