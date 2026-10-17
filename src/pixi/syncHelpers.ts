import { Container } from "pixi.js";
import type { FlatSceneNode, FlatFrameNode, FrameNode, SceneNode } from "@/types/scene";
import { isFlatFrameNode } from "@/types/scene";
import type { ThemeName } from "@/types/variable";
import type { createCullingIndex } from "./cullingIndex";
import {
  pushRenderTheme,
  popRenderTheme,
  resetRenderThemeStack,
  getRenderThemeStackDepth,
} from "./renderers/colorHelpers";

export interface SyncContext {
  sceneRoot: Container;
  registry: Map<string, RegistryEntry>;
  cullingIndex: ReturnType<typeof createCullingIndex>;
}

/**
 * Find a frame/group's children-host container — `"frame-children"` for
 * frames, `"group-children"` for groups (see `frameRenderer.ts` /
 * `groupRenderer.ts`). Every other node type has no such host and this
 * returns `null`. Shared so the label pair can't drift between call sites
 * (previously duplicated 3x in `syncNodeTree.ts` + 1x in `pixiSync.ts`).
 */
export function getChildrenHost(container: Container): Container | null {
  return (
    (container.getChildByLabel("frame-children") as Container | null) ??
    (container.getChildByLabel("group-children") as Container | null) ??
    null
  );
}

export interface RegistryEntry {
  container: Container;
  node: FlatSceneNode;
}

export type NodeLayoutOverride = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type AutoLayoutFrameSet = Set<string>;

export const TEXT_RESOLUTION_SHARPNESS_BOOST = 1.35;
export const TEXT_RESOLUTION_MAX_MULTIPLIER = 16;
export const EMBED_RESOLUTION_STEP = 0.25;
export const MIN_EMBED_RESOLUTION = 0.25;
export const EMBED_VIEWPORT_MARGIN = 300;

/**
 * Push ancestor theme overrides onto the render theme stack (outermost first).
 * Returns the number of themes pushed so the caller can pop them.
 */
function pushAncestorThemes(
  nodeId: string,
  parentById: Record<string, string | null>,
  nodesById: Record<string, FlatSceneNode>,
): number {
  // Collect ancestor theme overrides from root to parent
  const overrides: ThemeName[] = [];
  let cur = parentById[nodeId] ?? null;
  while (cur != null) {
    const n = nodesById[cur];
    if (n && isFlatFrameNode(n) && n.themeOverride) {
      overrides.push(n.themeOverride);
    }
    cur = parentById[cur] ?? null;
  }
  // Push from outermost ancestor to innermost (so innermost wins)
  for (let i = overrides.length - 1; i >= 0; i--) {
    pushRenderTheme(overrides[i]);
  }
  return overrides.length;
}

export function withAncestorThemes(
  nodeId: string,
  parentById: Record<string, string | null>,
  nodesById: Record<string, FlatSceneNode>,
  fn: () => void,
): void {
  // Guard against leaked render theme context from previous operations.
  if (getRenderThemeStackDepth() !== 0) {
    resetRenderThemeStack();
  }
  const pushed = pushAncestorThemes(nodeId, parentById, nodesById);
  try {
    fn();
  } finally {
    for (let i = 0; i < pushed; i++) popRenderTheme();
    // Keep stack invariant strict between operations.
    if (getRenderThemeStackDepth() !== 0) {
      resetRenderThemeStack();
    }
  }
}

/**
 * Convert flat frame to tree frame for layout calculation
 */
export function flatToTreeFrame(
  frameId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  layoutOverrides?: Map<string, NodeLayoutOverride>,
): FrameNode | null {
  const node = nodesById[frameId];
  if (!node || !isFlatFrameNode(node)) return null;

  const frameOverride = layoutOverrides?.get(frameId);
  const flatFrame: FlatFrameNode = {
    ...node,
    ...(frameOverride ?? {}),
  };
  const childIds = childrenById[frameId] ?? [];
  const children: SceneNode[] = [];

  for (const childId of childIds) {
    const childNode = nodesById[childId];
    if (!childNode) continue;

    const childOverride = layoutOverrides?.get(childId);

    if (childNode.type === "frame") {
      const childFrame = flatToTreeFrame(
        childId,
        nodesById,
        childrenById,
        layoutOverrides,
      );
      if (childFrame) children.push(childFrame);
    } else {
      children.push({
        ...(childNode as SceneNode),
        ...(childOverride ?? {}),
      });
    }
  }

  return {
    ...flatFrame,
    children,
  } as FrameNode;
}
