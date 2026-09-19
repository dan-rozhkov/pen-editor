import type { Container } from "pixi.js";

/**
 * The teardown shape every rAF-coalesced AI overlay layer
 * (`aiVectorPreviewLayer.ts`, `aiSvgPreviewLayer.ts`,
 * `aiPendingScreenLayer.ts`) ends with: unsubscribe from whichever store(s)
 * drive it, cancel any pending rAF flush, destroy every per-key entry, then
 * remove and destroy this layer's own root container. Factored out so a new
 * layer with this same lifecycle doesn't have to duplicate it verbatim.
 */
export function createAiOverlayTeardown(params: {
  overlayContainer: Container;
  root: Container;
  unsubscribes: Array<() => void>;
  cancelScheduledFlush: () => void;
  destroyAllEntries: () => void;
}): () => void {
  return () => {
    for (const unsubscribe of params.unsubscribes) unsubscribe();
    params.cancelScheduledFlush();
    params.destroyAllEntries();
    params.overlayContainer.removeChild(params.root);
    params.root.destroy();
  };
}
