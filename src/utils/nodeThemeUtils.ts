import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import type { ThemeName } from "@/types/variable";
import { THEME_COLLECTION_ID } from "@/types/variable";
import { getEffectiveModeContext, getFrameModeOverrides } from "@/lib/variables/modeContext";
import type { ModeContext } from "@/types/variable";

/**
 * The mode context a node resolves under: the document-level context plus every
 * ancestor frame's overrides (root to leaf, inner wins). A frame's own picks
 * affect its descendants, not itself.
 */
export function getEffectiveModeContextForNode(nodeId: string): ModeContext {
  const { parentById, nodesById } = useSceneStore.getState();
  return getEffectiveModeContext(parentById, nodesById, nodeId, useThemeStore.getState().modeContext);
}

/**
 * Compute the effective theme for a node by walking up its ancestor chain.
 * Returns the innermost ancestor frame's theme pick (`modeOverrides` or legacy `themeOverride`), or the global active theme.
 */
export function getEffectiveThemeForNode(nodeId: string): ThemeName {
  const { parentById, nodesById } = useSceneStore.getState();
  let cur = parentById[nodeId] ?? null;
  while (cur != null) {
    const picked = getFrameModeOverrides(nodesById[cur])[THEME_COLLECTION_ID];
    if (picked) return picked as ThemeName;
    cur = parentById[cur] ?? null;
  }
  return useThemeStore.getState().activeTheme;
}
