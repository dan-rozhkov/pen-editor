import { Container, Graphics, Sprite, Texture, Assets } from "pixi.js";
import type { ImageFill } from "@/types/scene";

/** Cache for loaded textures by URL */
const textureCache = new Map<string, Texture>();
const loadingUrls = new Set<string>();

async function loadTextureFromUrl(url: string): Promise<Texture> {
  try {
    return await Assets.load<Texture>(url);
  } catch (assetsError) {
    // Some image CDNs (e.g. Unsplash) use URLs without file extensions.
    // Pixi's Assets parser may skip those URLs, so fall back to browser image loading.
    const image = new Image();
    image.crossOrigin = "anonymous";

    const loadPromise = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Failed to load image URL: ${url}`));
    });

    image.src = url;
    await loadPromise;

    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      throw assetsError instanceof Error
        ? assetsError
        : new Error(`Image loaded with invalid dimensions: ${url}`);
    }

    return Texture.from(image);
  }
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

  const cached = textureCache.get(imageFill.url);
  if (cached) {
    addImageSprite(container, cached, imageFill, width, height, cornerRadius);
  } else if (!loadingUrls.has(imageFill.url)) {
    loadingUrls.add(imageFill.url);
    loadTextureFromUrl(imageFill.url).then((texture) => {
      loadingUrls.delete(imageFill.url);
      if (texture) {
        textureCache.set(imageFill.url, texture);
        // Check container still exists and needs this image
        if (!container.destroyed) {
          addImageSprite(container, texture, imageFill, width, height, cornerRadius);
        }
      }
    }).catch(() => {
      loadingUrls.delete(imageFill.url);
      // Keep this visible in devtools; otherwise failed image fills are silent.
      console.warn("[pixi] Failed to load image fill", imageFill.url);
    });
  }
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

  const cached = textureCache.get(imageFill.url);
  if (cached) {
    addImageSpriteEllipse(container, cached, imageFill, width, height);
  } else if (!loadingUrls.has(imageFill.url)) {
    loadingUrls.add(imageFill.url);
    loadTextureFromUrl(imageFill.url).then((texture) => {
      loadingUrls.delete(imageFill.url);
      if (texture && !container.destroyed) {
        textureCache.set(imageFill.url, texture);
        addImageSpriteEllipse(container, texture, imageFill, width, height);
      }
    }).catch(() => {
      loadingUrls.delete(imageFill.url);
      console.warn("[pixi] Failed to load image fill", imageFill.url);
    });
  }
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
