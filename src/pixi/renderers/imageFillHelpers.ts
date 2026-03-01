import { Container, Graphics, Sprite, Texture, Assets } from "pixi.js";
import type { ImageFill } from "@/types/scene";

/** Cache for loaded textures by URL */
const textureCache = new Map<string, Texture>();
/** Callbacks queued while a URL is already loading */
const loadingCallbacks = new Map<string, Array<() => void>>();

/** Load an image as an HTMLImageElement, optionally with CORS */
function loadImageAsTexture(url: string, useCors: boolean): Promise<Texture> {
  return new Promise<Texture>((resolve, reject) => {
    const image = new Image();
    if (useCors) image.crossOrigin = "anonymous";

    image.onload = () => {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        reject(new Error(`Image loaded with invalid dimensions: ${url}`));
        return;
      }
      resolve(Texture.from(image));
    };
    image.onerror = () => reject(new Error(`Failed to load image URL: ${url}`));

    image.src = url;
  });
}

async function loadTextureFromUrl(url: string): Promise<Texture> {
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
    return await loadImageAsTexture(url, true);
  } catch {
    // fall through
  }

  // Attempt 3: Browser image without CORS (works when server lacks CORS headers)
  return await loadImageAsTexture(url, false);
}

/** Load a texture by URL with caching and deduplication, then invoke callback */
function withTexture(
  url: string,
  container: Container,
  onReady: (texture: Texture) => void,
): void {
  const cached = textureCache.get(url);
  if (cached) {
    onReady(cached);
    return;
  }

  if (loadingCallbacks.has(url)) {
    loadingCallbacks.get(url)!.push(() => {
      const tex = textureCache.get(url);
      if (tex && !container.destroyed) onReady(tex);
    });
    return;
  }

  loadingCallbacks.set(url, []);
  loadTextureFromUrl(url).then((texture) => {
    textureCache.set(url, texture);
    if (!container.destroyed) onReady(texture);
    const cbs = loadingCallbacks.get(url);
    loadingCallbacks.delete(url);
    cbs?.forEach((cb) => cb());
  }).catch(() => {
    loadingCallbacks.delete(url);
    console.warn("[pixi] Failed to load image fill", url);
  });
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

  withTexture(imageFill.url, container, (texture) => {
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

  withTexture(imageFill.url, container, (texture) => {
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
