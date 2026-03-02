import { Container, Graphics, Sprite } from "pixi.js";
import type { EmbedNode } from "@/types/scene";
import { renderHtmlToTexture, invalidateHtmlTexture } from "./htmlTextureHelpers";

/** Current resolution used for embed textures, updated on zoom */
let currentEmbedResolution = window.devicePixelRatio;
const EMBED_RESIZE_RERENDER_DEBOUNCE_MS = 180;
const pendingResizeRerenderByContainer = new WeakMap<Container, ReturnType<typeof setTimeout>>();
const renderRequestIdByContainer = new WeakMap<Container, number>();

function drawPlaceholder(_gfx: Graphics, _width: number, _height: number): void {
  // No visual placeholder — container is transparent until texture loads
}

function getEmbedContentSprite(container: Container): Sprite | null {
  const existing = container.getChildByLabel("embed-content");
  return existing instanceof Sprite ? existing : null;
}

function ensureEmbedContentSprite(container: Container): Sprite {
  const existing = getEmbedContentSprite(container);
  if (existing) return existing;

  const sprite = new Sprite();
  sprite.label = "embed-content";
  sprite.roundPixels = true;
  container.addChild(sprite);
  return sprite;
}

function scheduleRerenderAfterResize(container: Container, node: EmbedNode): void {
  const pending = pendingResizeRerenderByContainer.get(container);
  if (pending) clearTimeout(pending);

  const timer = setTimeout(() => {
    pendingResizeRerenderByContainer.delete(container);
    if (container.destroyed || !node.htmlContent) return;
    renderAndApply(container, node);
  }, EMBED_RESIZE_RERENDER_DEBOUNCE_MS);

  pendingResizeRerenderByContainer.set(container, timer);
}

async function renderAndApply(container: Container, node: EmbedNode, resolution?: number): Promise<void> {
  const nextRequestId = (renderRequestIdByContainer.get(container) ?? 0) + 1;
  renderRequestIdByContainer.set(container, nextRequestId);

  const res = resolution ?? currentEmbedResolution;
  const texture = await renderHtmlToTexture(node.htmlContent, node.width, node.height, res);
  if (container.destroyed) return;

  // Ignore stale async completions when a newer render request already exists.
  if (renderRequestIdByContainer.get(container) !== nextRequestId) return;

  if (!texture) return;

  // Hide placeholder once texture is ready
  const bg = container.getChildByLabel("embed-bg");
  if (bg) bg.visible = false;

  const sprite = ensureEmbedContentSprite(container);
  sprite.texture = texture;
  sprite.width = node.width;
  sprite.height = node.height;
}

export function createEmbedContainer(node: EmbedNode): Container {
  const container = new Container();

  const bg = new Graphics();
  bg.label = "embed-bg";
  drawPlaceholder(bg, node.width, node.height);
  container.addChild(bg);

  if (node.htmlContent) {
    renderAndApply(container, node);
  }

  return container;
}

export function updateEmbedContainer(
  container: Container,
  node: EmbedNode,
  prev: EmbedNode,
): void {
  const sizeChanged = node.width !== prev.width || node.height !== prev.height;
  const contentChanged = node.htmlContent !== prev.htmlContent;

  if (sizeChanged) {
    const bg = container.getChildByLabel("embed-bg") as Graphics;
    if (bg) {
      bg.visible = true;
      drawPlaceholder(bg, node.width, node.height);
    }
  }

  if (contentChanged) {
    const pending = pendingResizeRerenderByContainer.get(container);
    if (pending) {
      clearTimeout(pending);
      pendingResizeRerenderByContainer.delete(container);
    }

    if (prev.htmlContent) {
      invalidateHtmlTexture(prev.htmlContent, prev.width, prev.height);
    }
    renderAndApply(container, node);
    return;
  }

  if (sizeChanged && node.htmlContent) {
    // Avoid expensive HTML rerender while pointer is moving; refresh once resize settles.
    scheduleRerenderAfterResize(container, node);
  }
}

/** Update global embed resolution and re-render a specific embed at the new resolution */
export function updateEmbedResolution(
  container: Container,
  node: EmbedNode,
  resolution: number,
): void {
  if (!node.htmlContent) return;
  renderAndApply(container, node, resolution);
}

/** Set the current embed resolution (call when zoom changes) */
export function setEmbedResolution(resolution: number): void {
  currentEmbedResolution = resolution;
}
