import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { buildCssForNodes } from "@/lib/designToCss/buildCss";
import { buildSvgForSelection } from "@/lib/designToSvg/buildSelectionSvg";
import { writeTextToClipboard } from "@/utils/clipboard";

/**
 * "Copy as CSS" / "Copy as SVG" — Figma-style design-to-code bridge. Reads
 * the current selection straight from the stores (same pattern as {@link
 * createStyleClipboardActions}) and writes generated text to the system
 * clipboard via the shared {@link writeTextToClipboard} helper. The
 * generators themselves (`buildCssForNodes`, `buildSvgForSelection`) are
 * pure and exported separately so they're unit-testable without
 * `navigator.clipboard`, which happy-dom doesn't provide.
 */

/**
 * Copy the current selection's CSS (dimensions, fills, strokes, effects,
 * corner radius, flex for auto-layout frames) to the clipboard — one rule
 * block per selected node, plus a `:root` tokens block for any bound
 * variables. No-op when nothing is selected.
 */
export async function copyAsCss(): Promise<boolean> {
  const { selectedIds } = useSelectionStore.getState();
  if (selectedIds.length === 0) return false;
  const { nodesById } = useSceneStore.getState();
  const { css, warnings } = buildCssForNodes(selectedIds, nodesById);
  if (warnings.length > 0) {
    console.warn("[copy-as-css] warnings:", warnings);
  }
  return writeTextToClipboard(css);
}

/**
 * Copy the current selection as standalone SVG markup to the clipboard.
 * No-op when nothing is selected.
 */
export async function copyAsSvg(): Promise<boolean> {
  const { selectedIds } = useSelectionStore.getState();
  if (selectedIds.length === 0) return false;
  const { nodesById, childrenById, parentById } = useSceneStore.getState();
  const { svg, warnings } = buildSvgForSelection(selectedIds, nodesById, childrenById, parentById);
  if (warnings.length > 0) {
    console.warn("[copy-as-svg] warnings:", warnings);
  }
  return writeTextToClipboard(svg);
}
