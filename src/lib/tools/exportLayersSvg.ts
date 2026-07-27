import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { buildSvgForSelection } from "@/lib/designToSvg/buildSelectionSvg";
import { getRenderableEffects } from "@/utils/fillUtils";
import type { FlatSceneNode } from "@/types/scene";
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

/** Collect a node id and every descendant id underneath it. */
function collectSubtreeIds(
  rootId: string,
  childrenById: Record<string, string[]>,
  out: string[],
): void {
  out.push(rootId);
  for (const childId of childrenById[rootId] ?? []) {
    collectSubtreeIds(childId, childrenById, out);
  }
}

/**
 * Estimate how far a node's rendered pixels can extend beyond its own
 * unrotated x/y/width/height box, in local px. This intentionally
 * over-estimates (it's used only to decide how much extra canvas to add
 * around the tight bounding box computed by `buildSvgForSelection`/
 * `convertDesignNodesToSvg`, both of which size the viewBox to the
 * unrotated bbox with no allowance for rotation overflow or filter bleed —
 * see the `<img>`-embedding note below).
 */
function estimateNodeBleed(node: FlatSceneNode): number {
  let bleed = 0;

  if (node.rotation) {
    // Enclosing AABB of a w×h rect rotated about its own center extends, at
    // worst (45°), by (diagonal - max(w, h)) / 2 beyond the unrotated box
    // on each side.
    const diag = Math.hypot(node.width, node.height);
    bleed = Math.max(bleed, (diag - Math.max(node.width, node.height)) / 2);
  }

  for (const effect of getRenderableEffects(node)) {
    if (effect.type === "blur" && effect.radius > 0) {
      // stdDeviation = radius / 2 in the emitted <feGaussianBlur>; visible
      // bleed of a Gaussian blur extends well past 1 stdDev, so pad generously.
      bleed = Math.max(bleed, effect.radius * 1.5);
    } else if (effect.type === "shadow" && effect.shadowType !== "inner") {
      const offset = Math.max(Math.abs(effect.offset.x), Math.abs(effect.offset.y));
      bleed = Math.max(bleed, effect.spread + effect.blur * 1.5 + offset);
    }
  }

  return bleed;
}

/**
 * `<img src="data:image/svg+xml;base64,...">` (what this tool tells the
 * model to do with its output) ALWAYS clips to the SVG's viewBox — the
 * root `overflow="visible"` attribute the serializer emits only affects
 * inline `<svg>` rendering, not image-context rendering. Both
 * `convertDesignNodesToSvg` and `buildSvgForSelection` size the viewBox to
 * the nodes' unrotated bounding box, so a rotated node or a node with
 * blur/drop-shadow gets visibly cropped in the exported image.
 *
 * Rather than changing the shared serializer's bbox math (risky: it's also
 * used by the user-facing "Copy as SVG" action, where inline rendering with
 * `overflow="visible"` already shows this content correctly), pad the
 * standalone document this tool returns: detect rotated/effect-bearing
 * nodes in the exported subtree, estimate how far they can bleed past the
 * tight bbox, and grow the canvas by that much on every side.
 */
function padSvgForBleed(svg: string, pad: number): { svg: string } {
  if (pad <= 0) return { svg };

  const openTagMatch = svg.match(/^<svg([^>]*)>/);
  if (!openTagMatch) return { svg };

  const widthMatch = svg.match(/\swidth="([\d.]+)"/);
  const heightMatch = svg.match(/\sheight="([\d.]+)"/);
  if (!widthMatch || !heightMatch) return { svg };

  const width = Number(widthMatch[1]);
  const height = Number(heightMatch[1]);
  const paddedWidth = width + pad * 2;
  const paddedHeight = height + pad * 2;
  // Preserve the original root's overflow behavior (present only when the
  // root frame doesn't explicitly clip, see `convertDesignNodesToSvg`) —
  // padding for rotation/filter bleed shouldn't also disable a frame's own
  // intentional child clipping.
  const overflowAttr = /\boverflow="visible"/.test(openTagMatch[1]) ? ' overflow="visible"' : "";

  const inner = svg.slice(openTagMatch[0].length, svg.lastIndexOf("</svg>"));
  const paddedSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${paddedWidth}" height="${paddedHeight}" ` +
    `viewBox="0 0 ${paddedWidth} ${paddedHeight}"${overflowAttr}>` +
    `<g transform="translate(${pad} ${pad})">${inner}</g></svg>`;

  return { svg: paddedSvg };
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
  // `nodeIds` is authoritative whenever it's passed at all — including an
  // explicit `[]`, which means "export nothing" (and reports the same
  // "no nodes" error below) rather than silently falling back to the
  // current selection. Only an *omitted* nodeIds falls back to selection.
  const explicitIds = args.nodeIds as string[] | undefined;
  const { nodesById, childrenById, parentById } = useSceneStore.getState();
  const nodeIds = explicitIds !== undefined ? explicitIds : useSelectionStore.getState().selectedIds;

  if (!nodeIds || nodeIds.length === 0) {
    return JSON.stringify({
      error: "No nodes to export: pass nodeIds (a non-empty array), or select one or more layers first.",
    });
  }

  const { svg: rawSvg, warnings } = buildSvgForSelection(nodeIds, nodesById, childrenById, parentById);

  if (!rawSvg) {
    return JSON.stringify({ error: "Nothing to export.", warnings });
  }

  if (rawSvg.length > MAX_SVG_LENGTH) {
    return JSON.stringify({
      error: `SVG export is too large (${rawSvg.length} characters, limit ${MAX_SVG_LENGTH}). Export fewer layers at once, or a smaller/simpler subtree.`,
    });
  }

  // The viewBox `buildSvgForSelection`/`convertDesignNodesToSvg` compute is
  // sized to the nodes' unrotated bounding box, with no allowance for
  // rotation overflow or filter (blur/shadow) bleed. That's fine for
  // "Copy as SVG" pasted inline (its `overflow="visible"` root attribute
  // covers it there), but this tool's own advice — embed the result as
  // `<img src="data:...">` — ALWAYS clips to the viewBox in image context,
  // so a rotated or blurred/shadowed export would silently come out
  // cropped. Detect that here and pad the canvas.
  let bleed = 0;
  for (const id of nodeIds) {
    const subtreeIds: string[] = [];
    collectSubtreeIds(id, childrenById, subtreeIds);
    for (const subId of subtreeIds) {
      const node = nodesById[subId];
      if (node) bleed = Math.max(bleed, estimateNodeBleed(node));
    }
  }
  const pad = Math.ceil(bleed);
  const { svg } = padSvgForBleed(rawSvg, pad);

  const widthMatch = svg.match(/\swidth="([\d.]+)"/);
  const heightMatch = svg.match(/\sheight="([\d.]+)"/);
  const width = widthMatch ? Number(widthMatch[1]) : undefined;
  const height = heightMatch ? Number(heightMatch[1]) : undefined;

  const bleedWarning =
    pad > 0
      ? [
          `Export includes a rotated node and/or a blur/drop-shadow effect; the canvas was padded by ~${pad}px on every side (width/height reflect this) to avoid clipping — this is an estimate, not an exact fit.`,
        ]
      : [];

  return JSON.stringify({
    success: true,
    dataUri: svgToDataUri(svg),
    width,
    height,
    ...(warnings.length > 0 || bleedWarning.length > 0 ? { warnings: [...warnings, ...bleedWarning] } : {}),
  });
};
