import { useEffect } from "react";
import type Konva from "konva";

/**
 * Manages Konva group caching for performance.
 * When `shouldCache` is true, caches the group at pixelRatio=1.
 * When false, clears the cache.
 *
 * Pass `deps` for additional values that should trigger a cache refresh
 * when they change (e.g. the node itself or its layout children).
 */
export function useKonvaGroupCaching(
  groupRef: React.RefObject<Konva.Group | null>,
  shouldCache: boolean,
  deps: readonly unknown[],
): void {
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    if (!shouldCache) {
      group.clearCache();
      return;
    }
    group.cache({ pixelRatio: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldCache, ...deps]);
}
