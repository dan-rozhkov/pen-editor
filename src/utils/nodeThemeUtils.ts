import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import type { FlatFrameNode } from "@/types/scene";
import type { ThemeName } from "@/types/variable";

/**
 * Compute the effective theme for a node by walking up its ancestor chain.
 * Returns the innermost ancestor frame's themeOverride, or the global active theme.
 */
export function getEffectiveThemeForNode(nodeId: string): ThemeName {
  const { parentById, nodesById } = useSceneStore.getState();
  let cur = parentById[nodeId] ?? null;
  while (cur != null) {
    const n = nodesById[cur];
    if (n?.type === "frame" && (n as FlatFrameNode).themeOverride) {
      return (n as FlatFrameNode).themeOverride as ThemeName;
    }
    cur = parentById[cur] ?? null;
  }
  return useThemeStore.getState().activeTheme;
}
