// Core of the "vectorize" image operation, shared by the agent tool
// (src/lib/tools/vectorizeImage) and the properties-panel button. See
// removeBackground.ts's header comment for why this lives once.
import { resolveApiUrl, isOffline } from "@/lib/apiBase";
import { createSnapshot, useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore, withHistoryBatch } from "@/store/historyStore";
import { parseSvgToNodes } from "@/utils/svgUtils";
import { scaleAndOffsetNode, shiftNode } from "@/lib/htmlToDesign/svgHandling";
import { isContainerNode, type SceneNode } from "@/types/scene";
import { applyImagePaintUrl, findNodeImagePaint, resolveNodeImageUrl } from "./resolveSourceUrl";

export type VectorizeMode = "image" | "layers";

// The only guard against a vectorized photograph dumping thousands of paths
// into the scene: /api/vectorize is happy to trace any raster, including
// ones that were never meant to become vector layers, and there is no way to
// know that in advance except by counting what came back.
export const MAX_VECTORIZE_NODES = 600;

export interface VectorizeResult {
  url: string;
  /** The id of the new root node inserted in place of the source (mode "layers" only). */
  nodeId?: string;
  /** Set when the parsed SVG exceeded MAX_VECTORIZE_NODES — nothing was inserted. */
  tooComplex?: true;
  nodeCount?: number;
  /**
   * Set when a meaningful number of shapes from the source SVG didn't make
   * it into the parsed tree at all (see `significantDrop` below) — most
   * commonly `parseSvgToNodes` (svgUtils.ts) silently skipping any shape
   * that resolves to neither a fill nor a stroke. The operation still runs
   * (something is better than nothing), but the caller needs to be able to
   * say out loud that the result is incomplete.
   */
  droppedShapes?: number;
}

async function requestVectorize(imageUrl: string): Promise<{ url: string; svg: string }> {
  if (isOffline()) {
    throw new Error("Offline: vectorizing requires a network connection.");
  }
  let res: Response;
  try {
    res = await fetch(resolveApiUrl("/api/vectorize"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl }),
    });
  } catch {
    throw new Error("Failed to reach the backend to vectorize the image.");
  }
  if (!res.ok) {
    if (res.status === 503) {
      throw new Error("Vectorization is not configured on this backend.");
    }
    throw new Error(`Vectorization failed (${res.status})`);
  }
  const data = (await res.json()) as { url?: string; svg?: string };
  if (!data.url) {
    throw new Error("Vectorization returned no url");
  }
  if (typeof data.svg !== "string" || data.svg.length === 0) {
    // The SVG text is only used for mode "layers"; mode "image" never reads
    // it, but a backend that omits it entirely is a contract break either
    // way — surface it instead of quietly degrading "layers" requests.
    throw new Error("Vectorization returned no SVG content");
  }
  return { url: data.url, svg: data.svg };
}

function countTreeNodes(node: SceneNode): number {
  let count = 1;
  if (isContainerNode(node)) {
    for (const child of node.children) count += countTreeNodes(child);
  }
  return count;
}

// Only the leaf shapes parseSvgToNodes actually produced — unlike
// countTreeNodes above (used for the MAX_VECTORIZE_NODES guard, where the
// synthetic group wrapper legitimately counts as "one more node in the
// scene"), a comparison against how many drawable elements the *source* SVG
// had must not count that wrapper, or every multi-shape SVG would look like
// it dropped one shape it never actually had.
function countLeafShapes(node: SceneNode): number {
  if (isContainerNode(node)) {
    return node.children.reduce((sum, child) => sum + countLeafShapes(child), 0);
  }
  return 1;
}

// How many "drawing" elements the raw SVG text declares, counted before
// parsing so it reflects the source, not whatever parseSvgToNodes kept.
// Regex, not a full parse: cheap, and this only needs a rough shape count to
// compare against — an over/undercount of a handful of elements from
// something like a matching substring inside an attribute value is
// tolerable given the threshold below is itself an approximation.
const SHAPE_TAG_RE = /<(?:path|rect|circle|ellipse|polygon|polyline|line)\b/g;

function countSourceShapeElements(svgText: string): number {
  return svgText.match(SHAPE_TAG_RE)?.length ?? 0;
}

// Thresholds for flagging "some shapes were silently dropped" (see
// parseSvgToNodes's fill/stroke-less skip in svgUtils.ts — a shape that
// resolves to neither a fill nor a stroke, from itself or inheritance, is
// left out of the result tree with no signal to the caller). Both
// conditions must hold:
//  - DROP_ABS_THRESHOLD (5): a tiny SVG losing 1-2 decorative shapes (e.g.
//    invisible guide rects) is common and not worth alarming over, even
//    though the *ratio* can look large (1 of 3 shapes = 33%).
//  - DROP_RATIO_THRESHOLD (10%): a huge SVG (hundreds of shapes) losing a
//    handful is normal noise; only flag it once the loss is a real fraction
//    of the drawing, not just a few outliers.
// Both together: only surfaces a drop that's both absolutely and
// proportionally meaningful — the case where the result would otherwise
// read as a clean, complete vectorization when it silently isn't.
const DROP_ABS_THRESHOLD = 5;
const DROP_RATIO_THRESHOLD = 0.1;

function significantDrop(sourceShapeCount: number, resultShapeCount: number): number | undefined {
  if (sourceShapeCount === 0) return undefined;
  const dropped = sourceShapeCount - resultShapeCount;
  if (dropped <= DROP_ABS_THRESHOLD) return undefined;
  if (dropped / sourceShapeCount <= DROP_RATIO_THRESHOLD) return undefined;
  return dropped;
}

/**
 * Cheap pre-parse reject for a hopelessly large SVG. `parseSvgToNodes`
 * forces a synchronous layout per shape — each one gets inserted into
 * `document.body` and measured via `getBBox()` (see `getPathBBox` in
 * svgUtils.ts) — so on a large trace (a photograph traced into tens of
 * thousands of paths) parsing alone can freeze the tab for seconds before
 * the exact node count is even known. Bail on the cheap regex count from
 * `countSourceShapeElements` when it's already far over budget, so a
 * hopeless input never reaches the expensive path. This is deliberately
 * approximate (see that function's own comment) and does NOT replace the
 * exact post-parse `nodeCount` check — it only skips parsing for the
 * unambiguous case; a source that passes this can still trip the real
 * guard afterward (e.g. stroke-only paths that split into extra nodes).
 */
function tooComplexBeforeParsing(svg: string): number | null {
  const shapeCount = countSourceShapeElements(svg);
  return shapeCount > MAX_VECTORIZE_NODES ? shapeCount : null;
}

const ROOT_INSERTION_PADDING = 50;

/**
 * A root-level position clear of existing top-level content — same idea as
 * `find_empty_space_on_canvas` (`src/lib/tools/findEmptySpace.ts`), inlined
 * here rather than shared: that tool returns a JSON string shaped for a
 * model tool-call, and this needs a plain `{x,y}` plus root-only bounds
 * (there is no source node here to inherit a parent/position from —
 * `vectorizeFromUrl` always inserts fresh at the root). Places the result to
 * the right of the current root-level bounding box, or at the origin on an
 * empty canvas.
 */
function findRootLevelInsertionPoint(): { x: number; y: number } {
  const { nodesById, rootIds } = useSceneStore.getState();
  let bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (const id of rootIds) {
    const node = nodesById[id];
    if (!node || node.visible === false) continue;
    if (!bounds) {
      bounds = { minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height };
    } else {
      bounds.minX = Math.min(bounds.minX, node.x);
      bounds.minY = Math.min(bounds.minY, node.y);
      bounds.maxX = Math.max(bounds.maxX, node.x + node.width);
      bounds.maxY = Math.max(bounds.maxY, node.y + node.height);
    }
  }
  if (!bounds) return { x: 0, y: 0 };
  return { x: bounds.maxX + ROOT_INSERTION_PADDING, y: bounds.minY };
}

/**
 * Vectorize an arbitrary image url (no source node in play — nothing to
 * replace or to inherit a target size/parent from). `mode: "image"` just
 * returns the url. `mode: "layers"` parses the returned SVG into a
 * scene-node tree and actually inserts it into the scene at the root level,
 * placed clear of existing top-level content (`findRootLevelInsertionPoint`)
 * at the SVG's own natural size. Same `MAX_VECTORIZE_NODES`/dropped-shapes
 * guards as `vectorizeNode` below; on `tooComplex`, nothing is inserted.
 */
export async function vectorizeFromUrl(
  url: string,
  opts: { mode: VectorizeMode },
): Promise<VectorizeResult> {
  const { url: resultUrl, svg } = await requestVectorize(url);
  if (opts.mode === "image") {
    return { url: resultUrl };
  }

  const preParseCount = tooComplexBeforeParsing(svg);
  if (preParseCount !== null) {
    return { url: resultUrl, tooComplex: true, nodeCount: preParseCount };
  }

  const parsed = parseSvgToNodes(svg);
  if (!parsed) {
    throw new Error("Vectorization succeeded but the SVG could not be parsed into layers.");
  }
  const nodeCount = countTreeNodes(parsed.node);
  const droppedShapes = significantDrop(countSourceShapeElements(svg), countLeafShapes(parsed.node));
  if (nodeCount > MAX_VECTORIZE_NODES) {
    return { url: resultUrl, tooComplex: true, nodeCount, ...(droppedShapes ? { droppedShapes } : {}) };
  }

  const insertionPoint = findRootLevelInsertionPoint();
  shiftNode(parsed.node, insertionPoint.x - parsed.node.x, insertionPoint.y - parsed.node.y);

  const { addNode } = useSceneStore.getState();
  useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
  withHistoryBatch(() => {
    addNode(parsed.node);
    useSelectionStore.getState().setSelectedIds([parsed.node.id]);
  });

  return {
    url: resultUrl,
    nodeId: parsed.node.id,
    nodeCount,
    ...(droppedShapes ? { droppedShapes } : {}),
  };
}

/**
 * Vectorize a node's (first) image fill.
 *
 * `mode: "image"` swaps the fill's url for the vectorized SVG url in place,
 * preserving `mode`/`crop`/`adjustments` (same as removeBackgroundOnNode).
 *
 * `mode: "layers"` parses the returned SVG into a scene-node tree, scales +
 * positions it to exactly cover the source node's box, and replaces the
 * source node with it as a single undo step (insert + delete batched via
 * `withHistoryBatch`, see store/historyStore.ts). If the parsed tree has
 * more than MAX_VECTORIZE_NODES nodes, nothing is inserted — the scene is
 * left untouched and the result reports `tooComplex`. `fills` lives on
 * `BaseNode`, so a `frame`/`group` with an image fill is a valid target too
 * — but `mode: "layers"` REFUSES one that has children: replacing it would
 * delete its entire subtree (`deleteNode` removes descendants + attached
 * connectors), which is never what "vectorize this image" means. `mode:
 * "image"` has no such restriction — it only swaps the fill's url in place
 * and never touches children.
 */
export async function vectorizeNode(
  nodeId: string,
  opts: { mode: VectorizeMode },
): Promise<VectorizeResult> {
  const sourceNode = useSceneStore.getState().nodesById[nodeId];
  if (!sourceNode) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  if (opts.mode === "layers") {
    const childIds = useSceneStore.getState().childrenById[nodeId];
    if (childIds && childIds.length > 0) {
      throw new Error(
        `Node ${nodeId} has ${childIds.length} child layer(s) — vectorizing its content would ` +
          `delete them along with the node itself. Select the image fill's own node (one with no ` +
          `children), or use mode: "image" to replace the fill in place without touching children.`,
      );
    }
  }

  const paint = findNodeImagePaint(nodeId);
  const sourceUrl = await resolveNodeImageUrl(nodeId);
  const { url: resultUrl, svg } = await requestVectorize(sourceUrl);

  if (opts.mode === "image") {
    applyImagePaintUrl(nodeId, paint.id, resultUrl);
    return { url: resultUrl };
  }

  const preParseCount = tooComplexBeforeParsing(svg);
  if (preParseCount !== null) {
    return { url: resultUrl, tooComplex: true, nodeCount: preParseCount };
  }

  const parsed = parseSvgToNodes(svg);
  if (!parsed) {
    throw new Error("Vectorization succeeded but the SVG could not be parsed into layers.");
  }
  const nodeCount = countTreeNodes(parsed.node);
  const droppedShapes = significantDrop(countSourceShapeElements(svg), countLeafShapes(parsed.node));
  if (nodeCount > MAX_VECTORIZE_NODES) {
    return { url: resultUrl, tooComplex: true, nodeCount, ...(droppedShapes ? { droppedShapes } : {}) };
  }

  // Re-read the source node right before mutating: its position/size (or
  // existence) may have changed during the network round trip.
  const latestSource = useSceneStore.getState().nodesById[nodeId];
  if (!latestSource) {
    throw new Error(`Node ${nodeId} was deleted before vectorization completed.`);
  }

  const scaleX = parsed.svgWidth > 0 ? latestSource.width / parsed.svgWidth : 1;
  const scaleY = parsed.svgHeight > 0 ? latestSource.height / parsed.svgHeight : 1;
  // parsed.node's own x/y are offsets within the SVG's own coordinate space
  // (0,0 at the SVG canvas origin) — scale by the ratio of the target box to
  // that canvas, then offset by the source node's (parent-relative) position
  // so the new tree lands exactly where the source node was.
  scaleAndOffsetNode(parsed.node, scaleX, scaleY, latestSource.x, latestSource.y);
  parsed.node.name = latestSource.name;

  const state = useSceneStore.getState();
  const { addNode, addChildToFrame, deleteNode, moveNode } = state;
  const parentId = state.parentById[nodeId] ?? null;
  // Capture the source node's position among its siblings before it's
  // touched — "vectorize this" means the result replaces it exactly,
  // including stacking order, not just position/size. A layer that was
  // sitting under others must not jump to the top of the stack.
  const siblingIds = parentId ? (state.childrenById[parentId] ?? []) : state.rootIds;
  const originalIndex = siblingIds.indexOf(nodeId);

  useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
  withHistoryBatch(() => {
    if (parentId) {
      addChildToFrame(parentId, parsed.node);
    } else {
      addNode(parsed.node);
    }
    deleteNode(nodeId);
    // addNode/addChildToFrame always append; reposition into the slot the
    // source node occupied. Deleting nodeId first means the sibling list at
    // this point is the original list with nodeId removed (and the new node
    // appended past the end) — splicing the new node in at originalIndex
    // reproduces the exact original ordering, because removing an element
    // at index i and then re-inserting a (different) element at index i
    // lands it in the same slot.
    if (originalIndex >= 0) {
      moveNode(parsed.node.id, parentId, originalIndex);
    }
    // Selection changes save their own history entry when made outside a
    // batch (see selectionStore.ts's saveSelectionHistoryIfChanged) — done
    // inside this batch, it's folded into the same undo step as the insert
    // + delete above instead of adding a second one.
    useSelectionStore.getState().setSelectedIds([parsed.node.id]);
  });

  return {
    url: resultUrl,
    nodeId: parsed.node.id,
    ...(droppedShapes ? { droppedShapes } : {}),
  };
}
