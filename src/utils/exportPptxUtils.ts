import type { PixiExportRefs } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useStyleStore } from "@/store/styleStore";
import { useVariableStore } from "@/store/variableStore";
import { getEffectiveThemeForNode } from "@/utils/nodeThemeUtils";
import { resolveColor } from "@/utils/colorUtils";
import { getFills, getRenderableStrokes, resolveFillStylePaint, resolveEffectStack } from "@/utils/fillUtils";
import { resolveRefToTree } from "@/utils/instanceRuntime";
import { getTopLevelFramesFlat } from "@/utils/componentUtils";
import { resolveSlideOrder } from "@/utils/slideOrder";
import { findContainerByLabel, extractImageBytes, downloadBlob, nodeContainsEmbed } from "@/utils/exportUtils";
import { sanitizeExportBaseName } from "@/utils/exportSettingsUtils";
import { buildSlidesInput, type BuildDeps } from "@/lib/pptxExport/buildSlidesInput";
import { assemblePptx } from "@/lib/pptxExport/assemblePptx";
import type { FrameNode, RefNode, SceneNode } from "@/types/scene";

/**
 * Export the Slides view (top-level frames, in SlidesPanel order) as an
 * editable .pptx. This is the Pixi/DOM-touching orchestrator — the tested
 * logic lives in `@/lib/pptxExport` (same split as PDF export, see
 * `exportFramesToPdf` in `exportPdfUtils.ts`). Not unit-tested itself (WebGL
 * extract can't run under happy-dom); the pure IR/XML/zip layers underneath
 * are covered by `src/lib/pptxExport/__tests__/`.
 */
export async function exportSlidesToPptx(pixiRefs: PixiExportRefs): Promise<boolean> {
  const { nodesById, rootIds, slideOrder, getNodes } = useSceneStore.getState();
  const { calculateLayoutForFrame } = useLayoutStore.getState();

  const orderedIds = resolveSlideOrder(nodesById, rootIds, slideOrder);
  const slideFlat = getTopLevelFramesFlat(nodesById, orderedIds);
  if (slideFlat.length === 0) {
    console.error("PPTX export: no slides (top-level frames) to export");
    return false;
  }

  // Tree nodes (with children populated) for the walk — getNodes() returns the tree.
  // `slideFlat` is already in SlidesPanel order (resolveSlideOrder); map preserves it.
  const treeById = new Map(getNodes().map((n) => [n.id, n]));
  const frames = slideFlat
    .map((f) => treeById.get(f.id))
    .filter((n): n is FrameNode => !!n && n.type === "frame");

  const deps: BuildDeps = {
    layoutChildren: (frame) => calculateLayoutForFrame(frame),
    resolveRef: (ref: RefNode): SceneNode | null => {
      const { nodesById: flat, childrenById } = useSceneStore.getState();
      return resolveRefToTree(ref, flat, childrenById);
    },
    getNodeFills: (node) => {
      const { fillStyles } = useStyleStore.getState();
      return getFills(node).map((paint) => resolveFillStylePaint(paint, fillStyles));
    },
    getNodeStrokes: (node) => {
      const { fillStyles } = useStyleStore.getState();
      return getRenderableStrokes(node).map((paint) => resolveFillStylePaint(paint, fillStyles));
    },
    getNodeEffects: (node) => {
      const { effectStyles } = useStyleStore.getState();
      return resolveEffectStack(node, effectStyles);
    },
    resolveColor: (lookup, node) => {
      const { variables } = useVariableStore.getState();
      const theme = getEffectiveThemeForNode(node.id);
      return resolveColor(lookup.color, lookup.binding, variables, theme);
    },
    // `container` missing is a benign "node vanished from the canvas mid-export"
    // case — skip the shape. An `extractImageBytes` failure whose node (or a
    // ref-resolved descendant) is an `embed` (FIR-63: no content, or a tainted
    // cross-origin canvas) is NOT caught here — it propagates through
    // `buildSlidesInput` and fails the whole PPTX export (see
    // `exportSlidesToPptx`'s try/catch below) rather than silently dropping
    // that shape from the slide. Any other rasterization failure (a
    // non-embed node — path/polygon/image-fill/blur — hitting a lost WebGL
    // context or similar) degrades gracefully to a skipped shape, same as
    // before FIR-63.
    rasterizeNode: async (nodeId, widthPx, heightPx, scale) => {
      const container = findContainerByLabel(pixiRefs.sceneRoot, nodeId);
      if (!container) return null;
      try {
        return await extractImageBytes(pixiRefs, nodeId, scale, { width: widthPx, height: heightPx }, "image/png");
      } catch (error) {
        if (nodeContainsEmbed(nodeId)) throw error;
        console.warn(`PPTX export: raster fallback failed for node ${nodeId}`, error);
        return null;
      }
    },
  };

  try {
    const input = await buildSlidesInput(frames, deps);
    const bytes = assemblePptx(input);
    downloadBlob(
      bytes,
      `${sanitizeExportBaseName(frames[0].name || "slides")}.pptx`,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    return true;
  } catch (error) {
    console.error("Failed to export PPTX:", error);
    return false;
  }
}
