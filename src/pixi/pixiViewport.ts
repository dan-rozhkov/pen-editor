import { Container } from "pixi.js";
import { useViewportStore } from "@/store/viewportStore";

/**
 * Subscribe to viewport store and apply pan/zoom transforms to the PixiJS viewport container.
 * Returns a cleanup function.
 */
export function setupPixiViewport(viewport: Container): () => void {
  // Apply initial state
  const initial = useViewportStore.getState();
  viewport.position.set(initial.x, initial.y);
  viewport.scale.set(initial.scale);

  // Subscribe to viewport store changes
  const unsubscribe = useViewportStore.subscribe((state) => {
    viewport.position.set(state.x, state.y);
    viewport.scale.set(state.scale);
  });

  return unsubscribe;
}
