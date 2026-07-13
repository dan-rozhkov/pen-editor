import type { PixiExportRefs } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useStyleStore } from "@/store/styleStore";
import { useVariableStore } from "@/store/variableStore";
import { getEffectiveThemeForNode } from "@/utils/nodeThemeUtils";
import { resolveColor } from "@/utils/colorUtils";
import { getFills, resolveFillStylePaint, resolveEffectStack } from "@/utils/fillUtils";
import { resolveRefToTree } from "@/utils/instanceRuntime";
import { getTopLevelFramesFlat } from "@/utils/componentUtils";
import { resolveSlideOrder } from "@/utils/slideOrder";
import { findContainerByLabel, toExtractFrame } from "@/utils/exportUtils";
import { withForcedRenderable, downloadBlob } from "@/utils/exportPdfUtils";
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
    getNodeEffects: (node) => {
      const { effectStyles } = useStyleStore.getState();
      return resolveEffectStack(node, effectStyles);
    },
    resolveColor: (lookup, node) => {
      const { variables } = useVariableStore.getState();
      const theme = getEffectiveThemeForNode(node.id);
      return resolveColor(lookup.color, lookup.binding, variables, theme);
    },
    rasterizeNode: (nodeId, widthPx, heightPx, scale) => {
      const container = findContainerByLabel(pixiRefs.sceneRoot, nodeId);
      if (!container) return null;
      try {
        return withForcedRenderable(container, pixiRefs.sceneRoot, () => {
          const canvas = pixiRefs.app.renderer.extract.canvas({
            target: container,
            resolution: scale,
            antialias: true,
            frame: toExtractFrame(widthPx, heightPx),
          }) as HTMLCanvasElement;
          const dataUrl = canvas.toDataURL("image/png");
          const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return bytes;
        });
      } catch (error) {
        console.warn(`PPTX export: raster fallback failed for node ${nodeId}`, error);
        return null;
      }
    },
  };

  try {
    const input = buildSlidesInput(frames, deps);
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
