import { useMemo } from "react";
import { findPickedComponentRegion, type PickedRegion } from "@/lib/embedComponents";
import { selectComponentRegistry } from "@/store/componentRegistry";
import { useSceneStore } from "@/store/sceneStore";

/**
 * The component region a picked element is managed by, or null: the element is
 * in plain HTML, in slot content (freely editable), in a screen that is itself
 * a master (masters are edited directly), or in a region whose key has no master.
 */
export function useManagedRegion(embedId: string, path: string, htmlContent: string): PickedRegion | null {
  const isMaster = useSceneStore(
    (s) => !!(s.nodesById[embedId] as { component?: unknown } | undefined)?.component,
  );
  return useMemo(() => {
    if (isMaster) return null;
    const region = findPickedComponentRegion(htmlContent, path);
    if (!region || region.zone !== "managed") return null;
    return selectComponentRegistry().has(region.key) ? region : null;
  }, [isMaster, htmlContent, path]);
}
