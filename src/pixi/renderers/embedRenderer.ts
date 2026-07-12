import { Container, Graphics } from "pixi.js";
import type { EmbedNode } from "@/types/scene";
import { drawOutlineBBox, isOutlineRenderMode } from "./outlineHelpers";

const EMBED_OUTLINE_BG_LABEL = "embed-outline-bg";

/**
 * Embeds ("code layers") now render as a Shadow-DOM overlay above the canvas
 * (see EmbedLayer). The Pixi side keeps only an empty, invisible container so
 * hit-testing, selection, drag and smart guides keep operating on the real
 * scene node. The HTML→texture pipeline (renderers/htmlTexture/*) is retained
 * for a future screenshot/export path but is intentionally not called here.
 *
 * Outline mode is the one exception: the DOM overlay has no wireframe
 * concept of its own, so a bounding-box stroke is drawn directly in Pixi —
 * the same fallback used for any other node type with no more specific
 * outline geometry.
 */
export function createEmbedContainer(node: EmbedNode): Container {
  const container = new Container();
  if (isOutlineRenderMode()) {
    const gfx = new Graphics();
    gfx.label = EMBED_OUTLINE_BG_LABEL;
    drawOutlineBBox(gfx, node.width, node.height);
    container.addChild(gfx);
  }
  return container;
}

export function updateEmbedContainer(
  container: Container,
  node: EmbedNode,
  prev: EmbedNode,
): void {
  if (!isOutlineRenderMode()) return;
  const gfx = container.getChildByLabel(EMBED_OUTLINE_BG_LABEL) as Graphics;
  if (gfx && (node.width !== prev.width || node.height !== prev.height)) {
    gfx.clear();
    drawOutlineBBox(gfx, node.width, node.height);
  }
}

/** Retained for syncResolution callers; embeds no longer use textures. */
export function updateEmbedResolution(
  _container: Container,
  _node: EmbedNode,
  _resolution: number,
): Promise<void> {
  return Promise.resolve();
}

/** Retained for syncResolution callers; embeds no longer use textures. */
export function setEmbedResolution(_resolution: number): void {
  // No-op.
}
