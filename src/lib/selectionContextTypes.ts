// Node types that render as a frame on canvas (a `ref` instance renders as
// its component's frame). These are never auto-screenshotted (see
// useSelectionScreenshots.ts) — the node's id already rides along in
// canvasContext's `selectedIds`/`selectedNodes`, so the model can call
// `get_screenshot` itself the moment a turn actually needs pixels. Kept in
// its own module (no React) so it can be imported from both the hook and
// plain helpers like `buildCanvasContext` in useDesignChat.ts without
// pulling React into a non-component context.
export const REFERENCE_ONLY_TYPES = new Set(["frame", "ref"]);

export function isReferenceOnlyNodeType(type: string): boolean {
  return REFERENCE_ONLY_TYPES.has(type);
}
