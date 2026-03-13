import type {
  SceneNode,
  FlatSceneNode,
  FlatSnapshot,
  HistorySnapshot,
  ComponentArtifact,
  InstanceOverrideUpdateProps,
} from "../../types/scene";

// ----- SceneState Interface -----

export interface SceneState {
  // Primary flat storage
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
  componentArtifactsById: Record<string, ComponentArtifact>;

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
  restoreSnapshot: (snapshot: FlatSnapshot | HistorySnapshot) => void;
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
  groupNodes: (ids: string[]) => string | null;
  ungroupNodes: (ids: string[]) => string[];
  convertNodeType: (id: string) => boolean;
  wrapInAutoLayoutFrame: (ids: string[]) => string | null;
  convertEmbedToDesign: (id: string) => Promise<string | null>;
  convertDesignToEmbed: (id: string) => string | null;
  updateInstanceOverride: (instanceId: string, path: string, updates: InstanceOverrideUpdateProps) => void;
  replaceInstanceNode: (instanceId: string, path: string, newNode: SceneNode) => void;
  resetInstanceOverride: (instanceId: string, path: string, property?: keyof InstanceOverrideUpdateProps) => void;
  toggleSlot: (frameId: string, childId: string) => void;
  detachInstance: (instanceId: string) => string | null;
  syncComponentToHtml: (componentId: string) => void;
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
  "textTransform",
]);
