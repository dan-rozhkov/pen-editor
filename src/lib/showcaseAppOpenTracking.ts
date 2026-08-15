/**
 * `showcase_app_opened` dedup, shared by every `ShowcaseCard`.
 *
 * The event must count APP opens, not overlay opens: tapping screen 1 then
 * screen 3 of the SAME app both toggle a card's action overlay open, but
 * that is one visitor opening one app, not two. Every screen of an app
 * renders its own `ShowcaseCard` instance (siblings inside the same
 * `ShowcaseAppCarousel`), so the dedup can't live in per-card React state —
 * it has to be shared across every card that can carry the same `appId`.
 *
 * A module-level `Set`, scoped to the page's life (never reset, no size
 * cap — the number of distinct apps a visitor opens in one visit is small),
 * is simplest: it survives across cards and carousels without threading
 * extra state through `ShowcaseAppCarousel`, and "already credited, don't
 * re-fire" is exactly the semantics a `Set` gives for free. Opening a
 * DIFFERENT app still fires, since it's a different, not-yet-seen id.
 *
 * Lives in its own module (rather than inside ShowcaseCard.tsx) because a
 * component file may only export components under this repo's Fast Refresh
 * lint rule.
 */
const trackedAppOpenIds = new Set<string>();

/**
 * Marks `appId` as credited if it wasn't already. Returns whether this call
 * is the one that should fire `showcase_app_opened` — i.e. `appId` had not
 * been credited yet.
 */
export function markShowcaseAppOpenedOnce(appId: string): boolean {
  if (trackedAppOpenIds.has(appId)) return false;
  trackedAppOpenIds.add(appId);
  return true;
}

/** Test-only: resets the module-level app-open dedup between tests. */
export function __resetShowcaseAppOpenTrackingForTests(): void {
  trackedAppOpenIds.clear();
}
