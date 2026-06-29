import { useSceneStore } from "@/store/sceneStore";

/**
 * True when the active page has at least one top-level frame. Returns a boolean
 * (cheap to compare) and avoids building/sorting an array in the selector.
 */
export function useHasFrames(): boolean {
  return useSceneStore((s) =>
    s.rootIds.some((id) => s.nodesById[id]?.type === "frame"),
  );
}
