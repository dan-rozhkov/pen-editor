import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useViewportStore } from "@/store/viewportStore";
import { getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import { embedScreenRect } from "./embedLayerGeometry";

/**
 * Positions an absolutely-placed DOM host over a scene node and keeps it synced
 * to viewport pan/zoom, layout, and scene changes. Shared by the embed and
 * shader overlays (both render live DOM above the Pixi canvas).
 *
 * The sync is imperative (no React re-render on pan/zoom): it writes
 * left/top/width/height directly and invokes `onSync(scale)` for any
 * component-specific extras (embeds scale their inner content; shaders update
 * their clip). `onSync` may change every render — it is read through a ref so
 * the subscriptions never churn. Returns `position` so callers can re-sync
 * imperatively after mounting content.
 */
export function useOverlayHostRect(
  hostRef: RefObject<HTMLDivElement | null>,
  nodeId: string,
  onSync?: (scale: number) => void,
): () => void {
  // Keep the latest onSync without churning the store subscriptions: read it
  // through a ref that we refresh in an effect (not during render).
  const onSyncRef = useRef(onSync);
  useEffect(() => {
    onSyncRef.current = onSync;
  }, [onSync]);

  const position = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = useSceneStore.getState();
    const n = scene.nodesById[nodeId];
    if (!n) return;
    const calc = useLayoutStore.getState().calculateLayoutForFrame;
    const abs = getNodeAbsolutePositionWithLayout(scene.getNodes(), nodeId, calc);
    if (!abs) return;
    const { scale, x: panX, y: panY } = useViewportStore.getState();
    const dpr = window.devicePixelRatio || 1;
    const rect = embedScreenRect(abs.x, abs.y, n.width, n.height, scale, panX, panY, dpr);
    host.style.left = `${rect.left}px`;
    host.style.top = `${rect.top}px`;
    host.style.width = `${rect.width}px`;
    host.style.height = `${rect.height}px`;
    onSyncRef.current?.(scale);
  }, [hostRef, nodeId]);

  useEffect(() => {
    position();
    const unsubViewport = useViewportStore.subscribe(position);
    const unsubLayout = useLayoutStore.subscribe(position);
    const unsubScene = useSceneStore.subscribe(position);
    return () => { unsubViewport(); unsubLayout(); unsubScene(); };
  }, [position]);

  return position;
}
