import { Container, Graphics, Sprite } from "pixi.js";
import type { EmbedNode } from "@/types/scene";
import { renderHtmlToTexture, invalidateHtmlTexture } from "./htmlTexture";

/** Current resolution used for embed textures, updated on zoom */
let currentEmbedResolution = window.devicePixelRatio;
const MIN_EMBED_RENDER_RESOLUTION = 0.25;
const EMBED_RESOLUTION_STEP = 0.25;
const MAX_EMBED_TEXTURE_DIMENSION = 8192;
const MAX_EMBED_TEXTURE_PIXELS = 16_777_216;
const EMBED_RESIZE_RERENDER_DEBOUNCE_MS = 180;
const pendingResizeRerenderByContainer = new WeakMap<Container, ReturnType<typeof setTimeout>>();
const renderRequestIdByContainer = new WeakMap<Container, number>();

function drawPlaceholder(): void {
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

function quantizeResolution(value: number): number {
  const stepped = Math.round(value / EMBED_RESOLUTION_STEP) * EMBED_RESOLUTION_STEP;
  return Math.max(MIN_EMBED_RENDER_RESOLUTION, stepped);
}

function getSafeEmbedResolution(node: EmbedNode, requestedResolution: number): number {
  const safeWidth = Math.max(1, node.width);
  const safeHeight = Math.max(1, node.height);
  const maxByDimension = MAX_EMBED_TEXTURE_DIMENSION / Math.max(safeWidth, safeHeight);
  const maxByPixels = Math.sqrt(MAX_EMBED_TEXTURE_PIXELS / (safeWidth * safeHeight));
  const upperBound = Math.max(
    MIN_EMBED_RENDER_RESOLUTION,
    Math.min(maxByDimension, maxByPixels),
  );

  return quantizeResolution(Math.min(requestedResolution, upperBound));
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
  if (!Number.isFinite(node.width) || !Number.isFinite(node.height) || node.width <= 0 || node.height <= 0) {
    return;
  }

  const nextRequestId = (renderRequestIdByContainer.get(container) ?? 0) + 1;
  renderRequestIdByContainer.set(container, nextRequestId);

  const requestedResolution = resolution ?? currentEmbedResolution;
  const res = getSafeEmbedResolution(node, requestedResolution);
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
  drawPlaceholder();
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
      drawPlaceholder();
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
