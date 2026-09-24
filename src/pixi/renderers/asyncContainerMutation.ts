/**
 * Hook for renderer code that mutates a node's Pixi container *asynchronously*
 * — i.e. outside any scene-store flush, so no `SceneDiff` ever observes it.
 * The canonical case is an image-fill texture finishing its network load and
 * `onReady` attaching the Sprite seconds after `applyImageFill` ran.
 *
 * The rendering-performance invariant (see `pen-editor/CLAUDE.md`, "Raster
 * cache") requires every such mutation to call both
 * `rasterCacheManager.onDirectContainerMutation(...)` and
 * `requestCanvasRender()`. Renderers don't own either (the manager lives
 * inside `createPixiSync`), so pixiSync installs a handler here and renderers
 * call `notifyAsyncContainerMutation(container)` synchronously BEFORE mutating.
 * Without it, a quiet top-level frame re-cached while the load was in flight
 * keeps its pre-load `cacheAsTexture` snapshot forever: Pixi only re-renders a
 * cached render group when `textureNeedsUpdate` is set, and adding a child
 * never sets it.
 *
 * Kept free of any PixiJS import so it can be unit-tested without WebGL.
 */

/** Minimal container surface the handler needs (walks up to a registered node). */
export interface AsyncMutationContainer {
  label?: string | null;
  parent?: AsyncMutationContainer | null;
  destroyed?: boolean;
}

type AsyncContainerMutationHandler = (container: AsyncMutationContainer) => void;

let handler: AsyncContainerMutationHandler | null = null;

/** Install (or clear, with `null`) the handler. Called by `createPixiSync`. */
export function setAsyncContainerMutationHandler(next: AsyncContainerMutationHandler | null): void {
  handler = next;
}

/**
 * Must be called synchronously BEFORE an out-of-flush mutation of `container`
 * (or any of its descendants) lands. No-op when no handler is installed.
 */
export function notifyAsyncContainerMutation(container: AsyncMutationContainer): void {
  handler?.(container);
}

/**
 * Walk up from `container` (usually a node's own container, but possibly an
 * internal child of one) to the nearest ancestor-or-self that is a registered
 * scene-node container, and return its node id. Node containers are labelled
 * with their node id (`renderers/index.ts`), but labels alone aren't proof —
 * internal children carry labels like "image-fill" — so `isRegistered` must
 * confirm the label→container mapping. Returns null for a detached container.
 */
export function resolveOwningNodeId(
  container: AsyncMutationContainer | null | undefined,
  isRegistered: (id: string, container: AsyncMutationContainer) => boolean,
): string | null {
  for (let c = container; c; c = c.parent) {
    if (c.label && isRegistered(c.label, c)) return c.label;
  }
  return null;
}
