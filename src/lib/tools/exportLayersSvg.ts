import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { buildSvgForSelection } from "@/lib/designToSvg/buildSelectionSvg";
import type { ToolHandler } from "../toolRegistry";

/**
 * Cap on the raw (pre-encoding) SVG markup, in characters. Chosen to
 * comfortably fit even a fairly elaborate vector logo (hundreds of `<path>`
 * elements) while rejecting an accidental whole-screen export before it
 * bloats the model's context with a multi-hundred-KB base64 blob. A
 * genuinely complex export that needs to be embedded 1:1 should be split
 * into fewer nodes or exported as a file (see the Copy-as-SVG / Export UI)
 * instead of round-tripped through the chat transcript.
 */
const MAX_SVG_LENGTH = 200_000;

function svgToDataUri(svg: string): string {
  // btoa requires a Latin1 string; escape/encodeURIComponent round-trip is
  // the standard browser-safe way to base64-encode UTF-8 text (same pattern
  // used elsewhere in this codebase, e.g. figmaToScene/paints.ts).
  const base64 = btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${base64}`;
}

/**
 * Export the selected (or given) layers to a standalone SVG document and
 * return it as a data URI, for the agent to drop straight into an `embed`
 * node's `htmlContent` as `<img src="...">`. This is the fix for the "AI
 * hand-reconstructs SVG path data and gets it wrong" failure mode (FIR-57):
 * reuses the exact serializer behind the user-facing "Copy as SVG" action
 * (`buildSvgForSelection` in `designToSvg/buildSelectionSvg.ts`) rather than
 * asking the model to regenerate vector geometry from scratch.
 */
export const exportLayersSvg: ToolHandler = async (args) => {
  const explicitIds = args.nodeIds as string[] | undefined;
  const { nodesById, childrenById, parentById } = useSceneStore.getState();
  const nodeIds =
    explicitIds && explicitIds.length > 0 ? explicitIds : useSelectionStore.getState().selectedIds;

  if (!nodeIds || nodeIds.length === 0) {
    return JSON.stringify({
      error: "No nodes to export: pass nodeIds, or select one or more layers first.",
    });
  }

  const { svg, warnings } = buildSvgForSelection(nodeIds, nodesById, childrenById, parentById);

  if (!svg) {
    return JSON.stringify({ error: "Nothing to export.", warnings });
  }

  if (svg.length > MAX_SVG_LENGTH) {
    return JSON.stringify({
      error: `SVG export is too large (${svg.length} characters, limit ${MAX_SVG_LENGTH}). Export fewer layers at once, or a smaller/simpler subtree.`,
    });
  }

  const widthMatch = svg.match(/width="([\d.]+)"/);
  const heightMatch = svg.match(/height="([\d.]+)"/);
  const width = widthMatch ? Number(widthMatch[1]) : undefined;
  const height = heightMatch ? Number(heightMatch[1]) : undefined;

  return JSON.stringify({
    success: true,
    dataUri: svgToDataUri(svg),
    width,
    height,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
};
