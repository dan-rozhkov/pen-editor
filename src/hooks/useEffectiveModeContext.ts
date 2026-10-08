import { useMemo } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import { getEffectiveModeContext, modeContextKey } from "@/lib/variables/modeContext";
import type { ModeContext } from "@/types/variable";

/**
 * The mode context a node resolves under: the document-level context plus
 * every ancestor frame's overrides. The Zustand selector returns a STRING
 * (`modeContextKey`), so the component re-renders only when the effective
 * picks actually change; the object is derived from that key with `useMemo`
 * (a selector returning a fresh object would re-render on every store change).
 * With no node id it is the document-level context.
 */
export function useEffectiveModeContext(nodeId: string | null | undefined): ModeContext {
  const key = useSceneStore((s) =>
    modeContextKey(
      nodeId
        ? getEffectiveModeContext(s.parentById, s.nodesById, nodeId, useThemeStore.getState().modeContext)
        : useThemeStore.getState().modeContext,
    ),
  );
  // Also depend on the document context so a doc-level switch re-renders.
  const docKey = useThemeStore((s) => modeContextKey(s.modeContext));
  return useMemo(() => {
    const { parentById, nodesById } = useSceneStore.getState();
    const base = useThemeStore.getState().modeContext;
    return nodeId ? getEffectiveModeContext(parentById, nodesById, nodeId, base) : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the context strings, not the store snapshots
  }, [nodeId, key, docKey]);
}
