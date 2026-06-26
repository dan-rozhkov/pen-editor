import { Container } from "pixi.js";
import type { EmbedNode } from "@/types/scene";

/**
 * Embeds ("code layers") now render as a Shadow-DOM overlay above the canvas
 * (see EmbedLayer). The Pixi side keeps only an empty, invisible container so
 * hit-testing, selection, drag and smart guides keep operating on the real
 * scene node. The HTML→texture pipeline (renderers/htmlTexture/*) is retained
 * for a future screenshot/export path but is intentionally not called here.
 */
export function createEmbedContainer(_node: EmbedNode): Container {
  return new Container();
}

export function updateEmbedContainer(
  _container: Container,
  _node: EmbedNode,
  _prev: EmbedNode,
): void {
  // No-op: content lives in the DOM overlay.
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
