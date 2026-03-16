import { Container } from "pixi.js";
import type { FlatSceneNode, FlatFrameNode, FrameNode, SceneNode, RefNode } from "@/types/scene";
import type { SceneState } from "@/store/sceneStore";
import {
  pushRenderTheme,
  popRenderTheme,
  resetRenderThemeStack,
  getRenderThemeStackDepth,
} from "./renderers/colorHelpers";

export interface SyncContext {
  sceneRoot: Container;
  registry: Map<string, RegistryEntry>;
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

function collectAffectedComponentIds(
  state: SceneState,
  prev: SceneState,
  changedIds: Set<string>,
): Set<string> {
  const affected = new Set<string>();

  const markFromChain = (
    startId: string,
    nodesById: Record<string, FlatSceneNode>,
    parentById: Record<string, string | null>,
  ): void => {
    let current: string | null = startId;
    while (current != null) {
      const node = nodesById[current];
      if (node?.type === "frame" && (node as FlatFrameNode).reusable) {
        affected.add(current);
      }
      current = parentById[current] ?? null;
    }
  };

  for (const id of changedIds) {
    if (state.nodesById[id]) {
      markFromChain(id, state.nodesById, state.parentById);
    }
    if (prev.nodesById[id]) {
      markFromChain(id, prev.nodesById, prev.parentById);
    }
  }

  return affected;
}

/**
 * Index mapping componentId → Set<refNodeId> for O(1) instance lookups.
 */
export class ComponentIdIndex {
  private index = new Map<string, Set<string>>();

  add(refNodeId: string, componentId: string): void {
    let set = this.index.get(componentId);
    if (!set) {
      set = new Set();
      this.index.set(componentId, set);
    }
    set.add(refNodeId);
  }

  remove(refNodeId: string, componentId: string): void {
    const set = this.index.get(componentId);
    if (set) {
      set.delete(refNodeId);
      if (set.size === 0) this.index.delete(componentId);
    }
  }

  getRefIds(componentId: string): ReadonlySet<string> {
    return this.index.get(componentId) ?? EMPTY_SET;
  }

  clear(): void {
    this.index.clear();
  }

  buildFrom(nodesById: Record<string, FlatSceneNode>): void {
    this.index.clear();
    for (const id of Object.keys(nodesById)) {
      const node = nodesById[id];
      if (node.type === "ref") {
        this.add(id, (node as RefNode).componentId);
      }
    }
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export function collectAffectedInstanceIds(
  state: SceneState,
  prev: SceneState,
  changedIds: Set<string>,
  componentIndex: ComponentIdIndex,
): Set<string> {
  const affectedComponentIds = collectAffectedComponentIds(state, prev, changedIds);
  if (affectedComponentIds.size === 0) return new Set<string>();

  const affectedInstances = new Set<string>();
  for (const compId of affectedComponentIds) {
    for (const refId of componentIndex.getRefIds(compId)) {
      affectedInstances.add(refId);
    }
  }
  return affectedInstances;
}

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
  const overrides: string[] = [];
  let cur = parentById[nodeId] ?? null;
  while (cur != null) {
    const n = nodesById[cur];
    if (n?.type === "frame" && (n as FlatFrameNode).themeOverride) {
      overrides.push((n as FlatFrameNode).themeOverride!);
    }
    cur = parentById[cur] ?? null;
  }
  // Push from outermost ancestor to innermost (so innermost wins)
  for (let i = overrides.length - 1; i >= 0; i--) {
    pushRenderTheme(overrides[i] as "light" | "dark");
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
  if (!node || node.type !== "frame") return null;

  const frameOverride = layoutOverrides?.get(frameId);
  const flatFrame = {
    ...(node as FlatFrameNode),
    ...(frameOverride ?? {}),
  } as FlatFrameNode;
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
