import { Container, Graphics, Sprite, Texture, Assets } from "pixi.js";
import type { FlatSceneNode, ImageFill } from "@/types/scene";

/** Cache for loaded textures by URL */
const textureCache = new Map<string, Texture>();
/** Callbacks queued while a URL is already loading */
const loadingCallbacks = new Map<string, Array<() => void>>();
/** Current resolution used for image fill textures, updated on zoom */
let currentImageFillResolution = window.devicePixelRatio || 1;

const SVG_TEXTURE_MAX_DIMENSION = 8192;

function isSvgUrl(url: string): boolean {
  return /^data:image\/svg\+xml/i.test(url) || /\.svg(?:[?#]|$)/i.test(url);
}

function getTextureCacheKey(
  url: string,
  width: number,
  height: number,
  resolution: number,
): string {
  if (!isSvgUrl(url)) return `img:${url}`;
  // Bucket resolution to avoid cache explosion during smooth zoom animation.
  const resolutionBucket = Math.max(1, Math.round(resolution * 4) / 4);
  return `svg:${url}:${Math.round(width)}x${Math.round(height)}@${resolutionBucket}`;
}

/** Load an image as an HTMLImageElement, optionally with CORS */
function loadImageElement(url: string, useCors: boolean): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (useCors) image.crossOrigin = "anonymous";

    image.onload = () => {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        reject(new Error(`Image loaded with invalid dimensions: ${url}`));
        return;
      }
      resolve(image);
    };
    image.onerror = () => reject(new Error(`Failed to load image URL: ${url}`));

    image.src = url;
  });
}

function createTextureFromImage(image: HTMLImageElement): Texture {
  return Texture.from(image);
}

async function loadRasterTextureFromUrl(url: string): Promise<Texture> {
  // Attempt 1: Pixi Assets loader
  // Note: Assets.load may resolve with null for URLs without file extensions
  // (e.g. Unsplash URLs with query params), so we must check the result.
  try {
    const tex = await Assets.load<Texture>(url);
    if (tex) return tex;
  } catch {
    // fall through
  }

  // Attempt 2: Browser image with CORS
  try {
    return createTextureFromImage(await loadImageElement(url, true));
  } catch {
    // fall through
  }

  // Attempt 3: Browser image without CORS (works when server lacks CORS headers)
  return createTextureFromImage(await loadImageElement(url, false));
}

function clampTextureDimension(value: number): number {
  return Math.max(1, Math.min(SVG_TEXTURE_MAX_DIMENSION, Math.round(value)));
}

async function loadSvgTextureFromUrl(
  url: string,
  width: number,
  height: number,
  resolution: number,
): Promise<Texture> {
  const image = await loadImageElement(url, true).catch(() => loadImageElement(url, false));

  const sourceWidth = Math.max(1, image.naturalWidth || width || 1);
  const sourceHeight = Math.max(1, image.naturalHeight || height || 1);
  const coverScale = Math.max(width / sourceWidth, height / sourceHeight, 1);
  const targetScale = Math.max(1, coverScale * Math.max(1, resolution));

  const targetWidth = clampTextureDimension(sourceWidth * targetScale);
  const targetHeight = clampTextureDimension(sourceHeight * targetScale);

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return createTextureFromImage(image);
  ctx.clearRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
  return Texture.from(canvas);
}

async function loadTextureFromUrl(
  url: string,
  width: number,
  height: number,
  resolution: number,
): Promise<Texture> {
  if (isSvgUrl(url)) {
    return loadSvgTextureFromUrl(url, width, height, resolution);
  }
  return loadRasterTextureFromUrl(url);
}

/** Load a texture by URL with caching and deduplication, then invoke callback */
function withTexture(
  url: string,
  width: number,
  height: number,
  container: Container,
  onReady: (texture: Texture) => void,
): void {
  const cacheKey = getTextureCacheKey(url, width, height, currentImageFillResolution);
  const cached = textureCache.get(cacheKey);
  if (cached) {
    onReady(cached);
    return;
  }

  if (loadingCallbacks.has(cacheKey)) {
    loadingCallbacks.get(cacheKey)!.push(() => {
      const tex = textureCache.get(cacheKey);
      if (tex && !container.destroyed) onReady(tex);
    });
    return;
  }

  loadingCallbacks.set(cacheKey, []);
  loadTextureFromUrl(url, width, height, currentImageFillResolution).then((texture) => {
    textureCache.set(cacheKey, texture);
    if (!container.destroyed) onReady(texture);
    const cbs = loadingCallbacks.get(cacheKey);
    loadingCallbacks.delete(cacheKey);
    cbs?.forEach((cb) => cb());
  }).catch(() => {
    loadingCallbacks.delete(cacheKey);
    console.warn("[pixi] Failed to load image fill", url);
  });
}

export function setImageFillResolution(resolution: number): void {
  currentImageFillResolution = resolution;
}

export function applyImageFill(
  container: Container,
  imageFill: ImageFill | undefined,
  width: number,
  height: number,
  cornerRadius?: number,
): void {
  // Remove existing image sprite
  const existing = container.getChildByLabel("image-fill");
  if (existing) {
    container.removeChild(existing);
    existing.destroy();
  }

  if (!imageFill?.url) return;

  withTexture(imageFill.url, width, height, container, (texture) => {
    addImageSprite(container, texture, imageFill, width, height, cornerRadius);
  });
}

/** Apply image scaling mode (stretch/fill/fit) to a sprite */
function scaleImageSprite(
  sprite: Sprite,
  texture: Texture,
  imageFill: ImageFill,
  containerW: number,
  containerH: number,
): void {
  const imgAspect = texture.width / texture.height;
  const containerAspect = containerW / containerH;

  if (imageFill.mode === "stretch") {
    sprite.width = containerW;
    sprite.height = containerH;
  } else if (imageFill.mode === "fill") {
    // Cover: fill container, crop overflow
    let sw: number, sh: number;
    if (imgAspect > containerAspect) {
      sh = containerH;
      sw = containerH * imgAspect;
    } else {
      sw = containerW;
      sh = containerW / imgAspect;
    }
    sprite.width = sw;
    sprite.height = sh;
    sprite.x = (containerW - sw) / 2;
    sprite.y = (containerH - sh) / 2;
  } else {
    // Fit: contain within bounds
    let sw: number, sh: number;
    if (imgAspect > containerAspect) {
      sw = containerW;
      sh = containerW / imgAspect;
    } else {
      sh = containerH;
      sw = containerH * imgAspect;
    }
    sprite.width = sw;
    sprite.height = sh;
    sprite.x = (containerW - sw) / 2;
    sprite.y = (containerH - sh) / 2;
  }
}

function addImageSprite(
  container: Container,
  texture: Texture,
  imageFill: ImageFill,
  containerW: number,
  containerH: number,
  cornerRadius?: number,
): void {
  // Remove any existing image sprite first
  const existing = container.getChildByLabel("image-fill");
  if (existing) {
    container.removeChild(existing);
    existing.destroy();
  }

  const sprite = new Sprite(texture);
  sprite.label = "image-fill";
  scaleImageSprite(sprite, texture, imageFill, containerW, containerH);

  // Apply mask for clipping (cornerRadius or bounds)
  if (cornerRadius && cornerRadius > 0) {
    const mask = new Graphics();
    mask.label = "image-mask";
    mask.roundRect(0, 0, containerW, containerH, cornerRadius);
    mask.fill(0xffffff);
    container.addChild(mask);
    sprite.mask = mask;
  }

  // Insert after background but before children
  const bgChild = container.getChildByLabel("rect-bg") ??
    container.getChildByLabel("ellipse-bg") ??
    container.getChildByLabel("frame-bg");
  if (bgChild) {
    const bgIndex = container.getChildIndex(bgChild);
    container.addChildAt(sprite, bgIndex + 1);
  } else {
    container.addChildAt(sprite, 0);
  }
}

export function applyImageFillEllipse(
  container: Container,
  imageFill: ImageFill | undefined,
  width: number,
  height: number,
): void {
  // Remove existing
  const existing = container.getChildByLabel("image-fill");
  if (existing) {
    container.removeChild(existing);
    existing.destroy();
  }
  const existingMask = container.getChildByLabel("image-mask");
  if (existingMask) {
    container.removeChild(existingMask);
    existingMask.destroy();
  }

  if (!imageFill?.url) return;

  withTexture(imageFill.url, width, height, container, (texture) => {
    addImageSpriteEllipse(container, texture, imageFill, width, height);
  });
}

function addImageSpriteEllipse(
  container: Container,
  texture: Texture,
  imageFill: ImageFill,
  containerW: number,
  containerH: number,
): void {
  const existing = container.getChildByLabel("image-fill");
  if (existing) {
    container.removeChild(existing);
    existing.destroy();
  }

  const sprite = new Sprite(texture);
  sprite.label = "image-fill";
  scaleImageSprite(sprite, texture, imageFill, containerW, containerH);

  // Elliptical mask
  const mask = new Graphics();
  mask.label = "image-mask";
  mask.ellipse(containerW / 2, containerH / 2, containerW / 2, containerH / 2);
  mask.fill(0xffffff);
  container.addChild(mask);
  sprite.mask = mask;

  const bgChild = container.getChildByLabel("ellipse-bg");
  if (bgChild) {
    const bgIndex = container.getChildIndex(bgChild);
    container.addChildAt(sprite, bgIndex + 1);
  } else {
    container.addChildAt(sprite, 0);
  }
}

export function updateImageFillResolution(
  container: Container,
  node: FlatSceneNode,
): void {
  if (!node.imageFill?.url || !isSvgUrl(node.imageFill.url)) return;

  if (node.type === "ellipse") {
    applyImageFillEllipse(container, node.imageFill, node.width, node.height);
    return;
  }

  if (node.type === "rect") {
    applyImageFill(container, node.imageFill, node.width, node.height, node.cornerRadius);
    return;
  }

  if (node.type === "frame") {
    const effectiveWidth = (container as { _effectiveWidth?: number })._effectiveWidth ?? node.width;
    const effectiveHeight = (container as { _effectiveHeight?: number })._effectiveHeight ?? node.height;
    applyImageFill(container, node.imageFill, effectiveWidth, effectiveHeight, node.cornerRadius);
  }
}
