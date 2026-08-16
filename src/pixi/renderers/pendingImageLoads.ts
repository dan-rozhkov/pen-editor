/**
 * Registry of in-flight remote-texture loads kicked off by `imageFillHelpers.ts`
 * (`withTexture`/`withPatternTileTexture`), so a screenshot can wait for a
 * just-set image fill's Sprite to actually be attached before extracting
 * pixels. Split into its own module — with no PixiJS import — so it can be
 * unit-tested without initializing a WebGL context (hard rule in this repo:
 * see `pen-editor/CLAUDE.md`).
 *
 * A load is tracked as a plain Promise from the moment it starts (network
 * fetch / Assets.load / CORS-proxy retry chain) until it settles — success or
 * failure alike, since a failed load still means the fill is "done trying"
 * and a screenshot should proceed rather than wait out the full timeout for
 * an image that will never appear.
 */

/** Currently in-flight loads, each already wrapped so it never rejects. */
const pendingLoads = new Set<Promise<void>>();

/**
 * Register a texture-load promise as "in flight". Safe to call with a
 * promise that may reject — failure still counts as settled and is swallowed
 * here so `waitForPendingImageFills` never rejects.
 */
export function registerPendingImageLoad(promise: Promise<unknown>): void {
  const tracked: Promise<void> = promise.then(
    () => undefined,
    () => undefined,
  );
  pendingLoads.add(tracked);
  void tracked.finally(() => {
    pendingLoads.delete(tracked);
  });
}

/** True while at least one remote-texture load is in flight. Exported for tests. */
export function hasPendingImageFillLoads(): boolean {
  return pendingLoads.size > 0;
}

/**
 * Resolve once no image-fill texture load is in flight, or once `timeoutMs`
 * elapses — whichever comes first. Never rejects: a screenshot must still be
 * produced even when an image genuinely can't load (the tool then degrades to
 * today's blank-sprite behavior rather than erroring).
 *
 * Loops rather than awaiting a single snapshot of the pending set, because
 * the retry chain (`Assets.load` → `<img crossOrigin>` → `/api/image-proxy`)
 * and sibling nodes loading in parallel may register new loads while this is
 * waiting on the current batch. Each iteration re-checks the deadline first,
 * so the loop always terminates by `timeoutMs` regardless of how many new
 * loads keep arriving.
 *
 * The registry is document-global — `withCachedTexture` (imageFillHelpers.ts)
 * also tracks pattern tiles and video thumbnails here, not just image fills —
 * so a caller waits on every remote image in flight anywhere in the document,
 * not just the node it's about to capture. Full subtree scoping is out of
 * scope for now; callers bound the damage instead by passing a shorter
 * `timeoutMs` for lower-stakes captures (see `captureNodeScreenshot.ts`,
 * which uses ~1.5s instead of the 10s default `get_screenshot` gets).
 */
export async function waitForPendingImageFills(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (pendingLoads.size > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;

    const currentBatch = Array.from(pendingLoads);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(currentBatch).then(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, remaining);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Test-only reset of the module-level registry, matching the codebase's
 * `__resetAnalyticsForTests()` naming (`src/lib/analytics/index.ts`). Without
 * this, a test that leaves a permanently-pending load registered (e.g. "never
 * settles") would leak into every later test sharing this singleton, forcing
 * tests to run in a specific order.
 */
export function __resetPendingImageLoadsForTests(): void {
  pendingLoads.clear();
}
