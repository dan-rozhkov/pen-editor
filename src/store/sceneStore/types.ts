import type {
  SceneNode,
  FlatSceneNode,
  FlatSnapshot,
  DescendantOverride,
} from "../../types/scene";

// ----- SceneState Interface -----

export interface SceneState {
  // Primary flat storage
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];

  // Backward compat: lazily cached tree
  _cachedTree: SceneNode[] | null;

  // UI state
  expandedFrameIds: Set<string>;
  pageBackground: string;

  // Get full tree (lazy, cached)
  getNodes: () => SceneNode[];

  // Mutations
  addNode: (node: SceneNode) => void;
  addChildToFrame: (frameId: string, child: SceneNode) => void;
  updateNode: (id: string, updates: Partial<SceneNode>) => void;
  updateMultipleNodes: (ids: string[], updates: Partial<SceneNode>) => void;
  updateNodeWithoutHistory: (id: string, updates: Partial<SceneNode>) => void;
  deleteNode: (id: string) => void;
  clearNodes: () => void;
  setNodes: (nodes: SceneNode[]) => void;
  setNodesWithoutHistory: (nodes: SceneNode[]) => void;
  restoreSnapshot: (snapshot: FlatSnapshot) => void;
  reorderNode: (fromIndex: number, toIndex: number) => void;
  setVisibility: (id: string, visible: boolean) => void;
  toggleVisibility: (id: string) => void;
  toggleFrameExpanded: (id: string) => void;
  setFrameExpanded: (id: string, expanded: boolean) => void;
  expandAncestors: (ids: string[]) => void;
  collapseAllFrames: () => void;
  moveNode: (
    nodeId: string,
    newParentId: string | null,
    newIndex: number,
  ) => void;
  updateDescendantOverride: (
    instanceId: string,
    descendantId: string,
    updates: DescendantOverride,
  ) => void;
  resetDescendantOverride: (
    instanceId: string,
    descendantId: string,
    property?: keyof DescendantOverride,
  ) => void;
  replaceSlotContent: (instanceId: string, slotChildId: string, newNode: SceneNode) => void;
  resetSlotContent: (instanceId: string, slotChildId: string) => void;
  updateSlotContentNode: (instanceId: string, slotChildId: string, updates: Partial<SceneNode>) => void;
  updateDescendantTextWithoutHistory: (instanceId: string, descendantId: string, text: string) => void;
  detachInstance: (instanceId: string) => void;
  groupNodes: (ids: string[]) => string | null;
  ungroupNodes: (ids: string[]) => string[];
  convertNodeType: (id: string) => boolean;
  wrapInAutoLayoutFrame: (ids: string[]) => string | null;
  setPageBackground: (color: string) => void;
}

// ----- Constants -----

// Properties that affect text measurement
export const TEXT_MEASURE_PROPS = new Set([
  "text",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "textWidthMode",
]);
