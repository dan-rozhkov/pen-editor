import type {
  SceneNode,
  FlatSceneNode,
  FlatSnapshot,
  HistorySnapshot,
  ComponentArtifact,
  ComponentPropertyDef,
  InstanceOverrideUpdateProps,
} from "../../types/scene";
import type { BooleanOpKind } from "../../lib/booleanOps";

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

  /**
   * Persistent presentation order of top-level frame ids ("slides"),
   * independent of canvas x/y and of `rootIds` (tree/z-order). The single
   * source of truth for both SlidesPanel and Present mode; resolve against
   * the current scene via `resolveSlideOrder` (drops deleted ids, appends
   * new top-level frames) rather than reading it raw.
   */
  slideOrder: string[];

  // Get full tree (lazy, cached)
  getNodes: () => SceneNode[];

  // Mutations
  addNode: (node: SceneNode) => void;
  addChildToFrame: (frameId: string, child: SceneNode) => void;
  updateNode: (id: string, updates: Partial<SceneNode>) => void;
  updateMultipleNodes: (ids: string[], updates: Partial<SceneNode>) => void;
  updateNodeWithoutHistory: (id: string, updates: Partial<SceneNode>) => void;
  updateNodesWithoutHistory: (
    updatesById: Record<string, Partial<SceneNode>>,
  ) => void;
  /** Batched per-id update (each id gets its own partial updates), recorded as a single history entry. */
  updateNodesById: (updatesById: Record<string, Partial<SceneNode>>) => void;
  deleteNode: (id: string) => void;
  clearNodes: () => void;
  setNodes: (nodes: SceneNode[]) => void;
  setNodesWithoutHistory: (nodes: SceneNode[]) => void;
  restoreSnapshot: (snapshot: FlatSnapshot | HistorySnapshot) => void;
  reorderNode: (fromIndex: number, toIndex: number) => void;
  /**
   * Reorder the slide presentation order (`slideOrder`) only — indices are
   * into the resolved slide order (see `resolveSlideOrder`), NOT into
   * `rootIds`. Does not touch `nodesById`/`rootIds`/coordinates/z-order;
   * writes history so it round-trips through undo/redo.
   */
  reorderSlide: (fromIndex: number, toIndex: number) => void;
  setVisibility: (id: string, visible: boolean) => void;
  toggleVisibility: (id: string) => void;
  /**
   * Sets a slide (top-level frame)'s speaker notes, recording one history
   * entry. Empty/whitespace-only text is normalized to `undefined`.
   */
  setSpeakerNotes: (id: string, text: string) => void;
  /**
   * Same as `setSpeakerNotes` but does not write history — used while typing
   * so a run of keystrokes collapses into the single history entry saved
   * when the textarea gains focus (mirrors InlineTextEditor's pattern).
   */
  setSpeakerNotesWithoutHistory: (id: string, text: string) => void;
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
  /**
   * Proportionally scale the given nodes AND their entire descendant
   * subtree by `factor` — geometry, typography, strokes, radii, effects,
   * and auto-layout gap/padding all scale together as one history entry.
   * `anchors` (optional, keyed by root id, in that root's parent-local
   * coordinate space) pins the fixed point of the scale for each root; a
   * root without an anchor entry scales from {0,0} in its parent's space.
   * `baseSizes` (per root id) overrides the stored width/height used as the
   * scale base — pass a gesture's effective (layout) size so the committed
   * geometry matches what was dragged. Overlapping roots (a root that is a
   * descendant of another root) are deduped.
   */
  scaleNodes: (
    ids: string[],
    factor: number,
    anchors?: Record<string, { x: number; y: number }>,
    baseSizes?: Record<string, { width: number; height: number }>,
  ) => void;
  booleanOperation: (ids: string[], op: BooleanOpKind) => string | null;
  convertEmbedToDesign: (id: string) => Promise<string | null>;
  convertDesignToEmbed: (id: string) => string | null;
  updateInstanceOverride: (instanceId: string, path: string, updates: InstanceOverrideUpdateProps) => void;
  updateInstanceOverrideWithoutHistory: (instanceId: string, path: string, updates: InstanceOverrideUpdateProps) => void;
  replaceInstanceNode: (instanceId: string, path: string, newNode: SceneNode) => void;
  updateSlotChildWithoutHistory: (instanceId: string, slotPath: string, relativePath: string, updates: Partial<SceneNode>) => void;
  resetInstanceOverride: (instanceId: string, path: string, property?: keyof InstanceOverrideUpdateProps) => void;
  toggleSlot: (frameId: string) => void;
  detachInstance: (instanceId: string) => string | null;
  setComponentProperties: (componentId: string, properties: ComponentPropertyDef[]) => void;
  setInstancePropertyValue: (instanceId: string, propertyId: string, value: string | boolean) => void;
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
  "paragraphSpacing",
  // wght/wdth/opsz axis values change glyph advance widths, same as fontWeight.
  "fontVariations",
  "textWidthMode",
  "textTransform",
  // maxLines caps auto-height; both re-derive the rendered/measured line set
  "maxLines",
  "truncateText",
  // sizing can force a textWidthMode normalization (fill width => wrap)
  "sizing",
  // list markers + indent change wrapping/auto-width (see textWrap.layoutTextParagraphs)
  "paragraphs",
]);
