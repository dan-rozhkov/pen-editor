import type { FrameNode, FlatSceneNode, EmbedNode, Paint, SceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { getNodeAbsolutePositionWithLayout, getNodeEffectiveSize } from "@/utils/nodeUtils";

type SerializeOptions = {
  resolveVars?: boolean;
  variableLookup?: Record<string, string>;
  preferSourceTemplate?: boolean;
};

// Per-document context shared across an entire serializeNodeToDepth call
// (one root node plus every descendant it recurses into). Reading the store
// and resolving the tree/layout-resolver ONCE here — instead of once per
// node, as before — avoids re-deriving the same document-wide values on
// every recursive step. See the perf note above `serializeNodeInternal` for
// why this matters.
interface SerializeContext {
  state: ReturnType<typeof useSceneStore.getState>;
  tree: SceneNode[];
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[];
}

/**
 * Serialize a flat node to a plain JSON object with depth-limited children.
 * Shared between batchGet and batchDesign executor.
 */
export function serializeNodeToDepth(
  nodeId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  depth: number,
  options?: SerializeOptions,
): Record<string, unknown> | null {
  const state = useSceneStore.getState();
  const ctx: SerializeContext = {
    state,
    tree: state.getNodes(),
    calculateLayoutForFrame: useLayoutStore.getState().calculateLayoutForFrame,
  };
  return serializeNodeInternal(nodeId, nodesById, childrenById, depth, ctx, options);
}

// perf (see finding #1 in the 2026-07-27 review): getNodeEffectiveSize /
// getNodeAbsolutePositionWithLayout each walk from the document root, so
// calling them per node while recursing over N nodes of an M-node document
// cost O(N·M). serializeNodeToDepth above now resolves the shared
// state/tree/calculateLayoutForFrame ONCE per top-level call and threads it
// through this recursive worker (nodeUtils.ts additionally memoizes the
// flattenTree() call inside getNodeEffectiveSize by tree reference, which
// covers the other call sites of that helper too). Combined with the fast
// path below — skipping layout resolution entirely for nodes that have no
// non-fixed sizing and no auto-layout parent — this keeps the common case
// cheap regardless of document size.
function serializeNodeInternal(
  nodeId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  depth: number,
  ctx: SerializeContext,
  options?: SerializeOptions,
): Record<string, unknown> | null {
  const node = nodesById[nodeId];
  if (!node) return null;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  // FIR-59: a node declared with `width`/`height: "fill_container"` (or
  // "fit_content") stores 0 as a creation-time placeholder in the flat node
  // (see batchDesign/nodeMapper.ts) — the real size (and, inside an
  // auto-layout parent, the real parent-relative position) only exists as a
  // layout *result*, computed on demand by the auto-layout engine
  // (src/utils/yogaLayout.ts via layoutStore.calculateLayoutForFrame). That
  // computation normally happens in the Pixi render path
  // (nodeRectResolution.ts) but was never applied when tools read nodes back
  // (batch_get, and batch_design's own createdNodes response) — so the agent
  // saw every fill_container/fit_content child as 0×0, and every sibling
  // after the first stacked at the same x/y, even though the canvas
  // rendered correctly. Resolve both here so tool reads match what's on
  // screen.
  const { state, tree, calculateLayoutForFrame } = ctx;
  const parentId = state.parentById[nodeId];
  const parentNode = parentId ? state.nodesById[parentId] : undefined;
  const parentIsAutoLayout =
    parentNode?.type === "frame" &&
    !!(parentNode as FlatSceneNode & { layout?: { autoLayout?: boolean } }).layout?.autoLayout;
  const nodeSizing = (node as FlatSceneNode & {
    sizing?: { widthMode?: string; heightMode?: string };
  }).sizing;
  const hasNonFixedSizing =
    !!nodeSizing &&
    ((!!nodeSizing.widthMode && nodeSizing.widthMode !== "fixed") ||
      (!!nodeSizing.heightMode && nodeSizing.heightMode !== "fixed"));

  // Fast path: a node whose own sizing is fixed (or unset) and whose
  // immediate parent isn't an auto-layout frame has nothing for yoga to
  // recompute — its stored width/height/x/y already ARE the effective
  // values, so skip the layout walk entirely.
  if (parentIsAutoLayout || hasNonFixedSizing) {
    try {
      // getNodeEffectiveSize walks the tree top-down from the root, so nested
      // fill_container/fit_content chains resolve correctly: each frame's
      // *own* resolved size (from its parent's layout pass) is what feeds the
      // next level's computation, not the raw 0-placeholder in the flat store.
      const size = getNodeEffectiveSize(tree, nodeId, calculateLayoutForFrame);
      if (size) {
        result.width = size.width;
        result.height = size.height;
      }

      // Position is only rewritten for children of an auto-layout frame — that
      // is the only case where yoga (not the stored x/y) determines placement.
      // getNodeAbsolutePositionWithLayout returns canvas-absolute coordinates,
      // so re-derive the parent-relative value the flat store actually uses by
      // subtracting the parent's own absolute position (also layout-resolved,
      // for a parent that is itself nested inside auto-layout ancestors).
      if (parentIsAutoLayout) {
        const pos = getNodeAbsolutePositionWithLayout(tree, nodeId, calculateLayoutForFrame);
        const parentPos = getNodeAbsolutePositionWithLayout(tree, parentId!, calculateLayoutForFrame);
        if (pos && parentPos) {
          result.x = pos.x - parentPos.x;
          result.y = pos.y - parentPos.y;
        }
      }
    } catch (err) {
      // Best-effort: fall back to the raw stored fields. The expected/benign
      // trigger is a node not part of the LIVE global scene store (e.g. an
      // ad-hoc/detached node built by a test fixture) — stay silent for that,
      // since state.getNodes()/state.parentById above are read from the real
      // store and simply won't know about such a node. Anything that throws
      // for a node the live store DOES know about is a genuine regression in
      // layout resolution, so surface it in dev builds (mirrors
      // instanceRuntime.ts's resolveRefToTree DEV-only warn).
      if (import.meta.env.DEV && state.nodesById[nodeId]) {
        console.warn(
          `[serializeNodeToDepth] layout resolution failed for node ${nodeId}, falling back to raw stored fields:`,
          err,
        );
      }
    }
  }

  // When preferSourceTemplate is set, replace htmlContent with sourceTemplate
  // for embed nodes that have authoring templates
  if (options?.preferSourceTemplate && node.type === "embed") {
    const embed = node as EmbedNode;
    if (embed.sourceTemplate) {
      result.htmlContent = embed.sourceTemplate;
    }
  }

  // Resolve variable bindings if requested
  if (options?.resolveVars && options.variableLookup) {
    const rec = node as unknown as Record<string, unknown>;
    const fillBinding = rec.fillBinding as { variableId: string } | undefined;
    if (fillBinding?.variableId && options.variableLookup[fillBinding.variableId]) {
      result.fill = options.variableLookup[fillBinding.variableId];
    }
    const strokeBinding = rec.strokeBinding as { variableId: string } | undefined;
    if (strokeBinding?.variableId && options.variableLookup[strokeBinding.variableId]) {
      result.stroke = options.variableLookup[strokeBinding.variableId];
    }
    const fills = rec.fills as Paint[] | undefined;
    if (fills?.some((p) => p.type === "solid" && p.colorBinding?.variableId)) {
      result.fills = fills.map((p) => {
        if (p.type !== "solid" || !p.colorBinding?.variableId) return p;
        const resolved = options.variableLookup![p.colorBinding.variableId];
        return resolved ? { ...p, color: resolved } : p;
      });
    }
  }

  // Add children for container types
  const childIds = childrenById[nodeId];
  if (childIds && childIds.length > 0) {
    if (depth <= 0) {
      result.children = "...";
    } else {
      result.children = childIds
        .map((cid) =>
          serializeNodeInternal(cid, nodesById, childrenById, depth - 1, ctx, options)
        )
        .filter(Boolean);
    }
  }

  return result;
}
