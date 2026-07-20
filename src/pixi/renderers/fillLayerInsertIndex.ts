import type { Container } from "pixi.js";

/** Index right after the node's fill layers (background + any image fill).
 *  Shared by the shader-fill and video-fill renderers, which both stack their
 *  sprite above the background/image fill but below child nodes. */
export function fillLayerInsertIndex(container: Container): number {
  const imageFill = container.getChildByLabel("image-fill");
  if (imageFill) return container.getChildIndex(imageFill) + 1;
  const bg =
    container.getChildByLabel("rect-bg") ??
    container.getChildByLabel("ellipse-bg") ??
    container.getChildByLabel("frame-bg");
  if (bg) return container.getChildIndex(bg) + 1;
  return 0;
}
