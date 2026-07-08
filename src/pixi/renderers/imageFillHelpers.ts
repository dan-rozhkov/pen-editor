import { Container, Graphics, Sprite, Texture, Assets, Rectangle, TilingSprite, ColorMatrixFilter } from "pixi.js";
import type { FlatSceneNode, ImageAdjustments, ImageFill, ImagePaint, PatternFill, PatternPaint, PerCornerRadius } from "@/types/scene";
import { getResolvedRenderableFills } from "./colorHelpers";
import { normalizePattern } from "@/utils/patternUtils";
import { drawRoundedShape, resolvePaintBlendMode } from "./fillStrokeHelpers";
import { buildPatternSprite } from "./patternFillHelpers";
import { hasPerCornerRadius } from "@/utils/renderUtils";
import { cropRectToPixels, coverPixelRect, type PixelRect } from "@/lib/imageCrop/cropRect";
import { buildAdjustmentColorMatrix, isDefaultAdjustments } from "@/lib/imageAdjustments/imageAdjustments";

/** Cache for loaded textures by URL (LRU, bounded — SVG keys include size/resolution,
 *  so interactive resize/zoom would otherwise grow it without limit) */
const textureCache = new Map<string, Texture>();
const TEXTURE_CACHE_MAX_ENTRIES = 128;
/** Callbacks queued while a URL is already loading */
const loadingCallbacks = new Map<string, Array<() => void>>();

function getCachedTexture(key: string): Texture | undefined {
  const texture = textureCache.get(key);
  if (texture) {
    // Refresh LRU position
    textureCache.delete(key);
    textureCache.set(key, texture);
  }
  return texture;
}

function setCachedTexture(key: string, texture: Texture): void {
  textureCache.delete(key);
  textureCache.set(key, texture);
  // Evict oldest entries without destroying — live sprites may still reference
  // them; Pixi's texture GC reclaims unused GPU memory once unreferenced.
  while (textureCache.size > TEXTURE_CACHE_MAX_ENTRIES) {
    const oldestKey = textureCache.keys().next().value;
    if (oldestKey === undefined) break;
    textureCache.delete(oldestKey);
  }
}
/** Current resolution used for image fill textures, updated on zoom */
let currentImageFillResolution = window.devicePixelRatio || 1;

const SVG_TEXTURE_MAX_DIMENSION = 8192;

/** Last SVG fill applied per container, so a size-only change can re-stretch the
 *  existing sprite cheaply and defer the sharp re-rasterization (mirrors the
 *  embed renderer's resize-debounce pattern). */
interface AppliedImageFill {
  url: string;
  width: number;
  height: number;
}
const appliedImageFillByContainer = new WeakMap<Container, AppliedImageFill>();
const pendingSvgRerenderByContainer = new WeakMap<Container, ReturnType<typeof setTimeout>>();
const SVG_FILL_RESIZE_RERENDER_DEBOUNCE_MS = 180; // mirrors EMBED_RESIZE_RERENDER_DEBOUNCE_MS

export function isSvgUrl(url: string): boolean {
  return /^data:image\/svg\+xml/i.test(url) || /\.svg(?:[?#]|$)/i.test(url);
}

export function getTextureCacheKey(
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

/**
 * Rasterize an SVG tile at its *natural* size × pattern scale × resolution —
 * NOT the node's fill-area size. A pattern tile is meant to repeat at a fixed
 * physical size regardless of how big the container is; rasterizing it at
 * container size (like a cover-fit image fill) would stretch a single tile to
 * fill the whole node instead of tiling it.
 */
async function loadSvgPatternTextureFromUrl(
  url: string,
  scale: number,
  resolution: number,
): Promise<Texture> {
  const image = await loadImageElement(url, true).catch(() => loadImageElement(url, false));

  const sourceWidth = Math.max(1, image.naturalWidth || 1);
  const sourceHeight = Math.max(1, image.naturalHeight || 1);
  const targetScale = Math.max(1, scale * Math.max(1, resolution));

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

/**
 * Load a pattern paint's tile texture with caching/deduplication, keyed on the
 * pattern's own params (url, scale, resolution) — never on the node's fill
 * area — so a resize never invalidates the cache (see `buildPatternSprite`,
 * which applies spacing/stagger/tileScale on top of this natural-size tile).
 * Raster tile sources (png/jpeg/dataURL) are unaffected: they already load at
 * their native pixel size via the plain `withTexture` raster path.
 */
/**
 * Cache key for a pattern tile's rasterized texture — deliberately independent
 * of the node's fill-area size (unlike `getTextureCacheKey`), since the tile
 * always rasterizes at its own natural size × scale regardless of container.
 * Exported for unit testing.
 */
export function getPatternTextureCacheKey(
  url: string,
  scale: number,
  resolution: number,
): string {
  if (!isSvgUrl(url)) return `img:${url}`;
  const resolutionBucket = Math.max(1, Math.round(resolution * 4) / 4);
  return `svg-pattern:${url}:${scale}@${resolutionBucket}`;
}

function withPatternTileTexture(
  url: string,
  pattern: PatternFill,
  container: Container,
  onReady: (texture: Texture) => void,
): void {
  if (!isSvgUrl(url)) {
    withTexture(url, 0, 0, container, onReady);
    return;
  }

  const p = normalizePattern(pattern);
  const cacheKey = getPatternTextureCacheKey(url, p.scale, currentImageFillResolution);

  const cached = getCachedTexture(cacheKey);
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
  loadSvgPatternTextureFromUrl(url, p.scale, currentImageFillResolution).then((texture) => {
    setCachedTexture(cacheKey, texture);
    if (!container.destroyed) onReady(texture);
    const cbs = loadingCallbacks.get(cacheKey);
    loadingCallbacks.delete(cacheKey);
    cbs?.forEach((cb) => cb());
  }).catch(() => {
    loadingCallbacks.delete(cacheKey);
    console.warn("[pixi] Failed to load pattern tile", url);
  });
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
  const cached = getCachedTexture(cacheKey);
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
    setCachedTexture(cacheKey, texture);
    if (!container.destroyed) onReady(texture);
    const cbs = loadingCallbacks.get(cacheKey);
    loadingCallbacks.delete(cacheKey);
    cbs?.forEach((cb) => cb());
  }).catch(() => {
    loadingCallbacks.delete(cacheKey);
    console.warn("[pixi] Failed to load image fill", url);
  });
}

function destroyImageSprite(container: Container): void {
  appliedImageFillByContainer.delete(container);
  const existing = container.getChildByLabel("image-fill");
  if (!existing) return;

  container.removeChild(existing);
  if (existing instanceof Sprite) {
    const derivedTexture = (existing as Sprite & { _derivedImageTexture?: Texture })
      ._derivedImageTexture;
    if (derivedTexture) {
      derivedTexture.destroy(false);
    }
  }
  existing.destroy();
}

/**
 * Build a "cover" (aspect-fill) texture within an optional base pixel rect
 * (the crop rect, in source pixel coordinates). Defaults to the whole
 * texture when no base rect is given, matching the original uncropped
 * behavior. See `coverPixelRect` for the pure geometry.
 */
function createCoverTexture(
  texture: Texture,
  containerW: number,
  containerH: number,
  basePx: PixelRect = { x: 0, y: 0, width: texture.width, height: texture.height },
): Texture {
  const cover = coverPixelRect(basePx, containerW, containerH);
  return new Texture({
    source: texture.source,
    frame: new Rectangle(cover.x, cover.y, cover.width, cover.height),
  });
}

/** Build a texture cropped to a source pixel rect (no cover-fit, just the raw sub-region). */
function createCroppedTexture(texture: Texture, cropPx: PixelRect): Texture {
  return new Texture({
    source: texture.source,
    frame: new Rectangle(cropPx.x, cropPx.y, cropPx.width, cropPx.height),
  });
}

export function setImageFillResolution(resolution: number): void {
  currentImageFillResolution = resolution;
}

/** Re-stretch an existing image sprite to a new size without reloading the
 *  texture. `scaleImageSprite` re-derives the `fill`-mode cover texture from the
 *  original (uncropped) texture recorded as `_baseImageTexture`, so we destroy
 *  the previous derived cover first to avoid leaking it. */
function restretchExistingSprite(
  sprite: Sprite,
  imageFill: ImageFill,
  width: number,
  height: number,
): void {
  const typed = sprite as Sprite & {
    _baseImageTexture?: Texture;
    _derivedImageTexture?: Texture;
  };
  const baseTexture = typed._baseImageTexture ?? sprite.texture;
  const prevDerived = typed._derivedImageTexture;
  scaleImageSprite(sprite, baseTexture, imageFill, width, height);
  // If a new cover texture was created, destroy the previous one (now unused).
  const newDerived = typed._derivedImageTexture;
  if (prevDerived && prevDerived !== newDerived) {
    prevDerived.destroy(false);
  }
}

/**
 * Fast path for a size-only change of an SVG image fill: re-stretch the existing
 * sprite immediately (cheap) and defer the sharp re-rasterization until the
 * resize gesture settles. Returns true when it handled the call, false to fall
 * through to the full (immediate) path. Mirrors the embed resize-debounce.
 */
function trySvgResizeFastPath(
  container: Container,
  imageFill: ImageFill | undefined,
  width: number,
  height: number,
  scheduleFullRerender: () => void,
  redrawMask: (mask: Graphics) => void,
): boolean {
  if (!imageFill?.url || !isSvgUrl(imageFill.url)) return false;

  const prev = appliedImageFillByContainer.get(container);
  const existing = container.getChildByLabel("image-fill");
  if (
    !(existing instanceof Sprite) ||
    !prev ||
    prev.url !== imageFill.url ||
    (prev.width === width && prev.height === height)
  ) {
    return false;
  }

  // Size-only change of the same SVG fill: stretch now, re-rasterize later.
  const pending = pendingSvgRerenderByContainer.get(container);
  if (pending) clearTimeout(pending);

  restretchExistingSprite(existing, imageFill, width, height);
  // `scaleImageSprite` (called above) already re-derives crop/mode geometry from
  // `_baseImageTexture`, but it never touches filters — re-apply adjustments here
  // too so a simultaneous size+adjustments change doesn't leave a stale
  // ColorMatrixFilter until the debounced full re-render fires.
  applyImageAdjustments(existing, imageFill.adjustments);

  const mask = container.getChildByLabel("image-mask");
  if (mask instanceof Graphics) {
    mask.clear();
    redrawMask(mask);
  }

  appliedImageFillByContainer.set(container, { url: imageFill.url, width, height });

  const timer = setTimeout(() => {
    pendingSvgRerenderByContainer.delete(container);
    if (container.destroyed) return;
    scheduleFullRerender();
  }, SVG_FILL_RESIZE_RERENDER_DEBOUNCE_MS);
  pendingSvgRerenderByContainer.set(container, timer);

  return true;
}

export function applyImageFill(
  container: Container,
  imageFill: ImageFill | undefined,
  width: number,
  height: number,
  cornerRadius?: number,
  cornerRadiusPerCorner?: PerCornerRadius,
  cornerSmoothing?: number,
): void {
  const handled = trySvgResizeFastPath(
    container,
    imageFill,
    width,
    height,
    () => applyImageFill(container, imageFill, width, height, cornerRadius, cornerRadiusPerCorner, cornerSmoothing),
    (mask) => {
      drawRoundedShape(mask, width, height, cornerRadius, cornerRadiusPerCorner, cornerSmoothing);
      mask.fill(0xffffff);
    },
  );
  if (handled) return;

  // Full path: clear any pending re-render, then rebuild the sprite immediately.
  const pending = pendingSvgRerenderByContainer.get(container);
  if (pending) {
    clearTimeout(pending);
    pendingSvgRerenderByContainer.delete(container);
  }

  // Remove existing image sprite
  destroyImageSprite(container);

  if (!imageFill?.url) return;

  withTexture(imageFill.url, width, height, container, (texture) => {
    addImageSprite(container, texture, imageFill, width, height, cornerRadius, cornerRadiusPerCorner, cornerSmoothing);
  });
}

/**
 * Apply image scaling mode (stretch/fill/fit) to a sprite, honoring an
 * optional crop rect (`imageFill.crop`, normalized 0-1 source coordinates —
 * see `@/lib/imageCrop/cropRect`). The crop always applies against the
 * ORIGINAL (uncropped) `texture` passed in — callers always pass the base
 * texture here (see `_baseImageTexture` bookkeeping), so resizing a node
 * after cropping re-derives the mode's fit/cover geometry from the crop
 * rect instead of stretching or compounding crops.
 */
function scaleImageSprite(
  sprite: Sprite,
  texture: Texture,
  imageFill: ImageFill,
  containerW: number,
  containerH: number,
): void {
  const typed = sprite as Sprite & {
    _baseImageTexture?: Texture;
    _derivedImageTexture?: Texture;
  };
  // Remember the original (uncropped) texture so a later resize fast path can
  // re-derive the mode's cover/fit/crop geometry from it instead of compounding.
  typed._baseImageTexture = texture;

  const cropPx = cropRectToPixels(imageFill.crop, texture.width, texture.height);
  const hasCrop = !!imageFill.crop;
  const imgAspect = cropPx.width / cropPx.height;
  const containerAspect = containerW / containerH;

  let derivedTexture: Texture | undefined;

  if (imageFill.mode === "stretch") {
    derivedTexture = hasCrop ? createCroppedTexture(texture, cropPx) : undefined;
    sprite.texture = derivedTexture ?? texture;
    sprite.width = containerW;
    sprite.height = containerH;
    sprite.x = 0;
    sprite.y = 0;
  } else if (imageFill.mode === "fill") {
    const coverTexture = createCoverTexture(texture, containerW, containerH, cropPx);
    derivedTexture = coverTexture;
    sprite.texture = coverTexture;
    sprite.width = containerW;
    sprite.height = containerH;
    sprite.x = 0;
    sprite.y = 0;
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
    derivedTexture = hasCrop ? createCroppedTexture(texture, cropPx) : undefined;
    sprite.texture = derivedTexture ?? texture;
    sprite.width = sw;
    sprite.height = sh;
    sprite.x = (containerW - sw) / 2;
    sprite.y = (containerH - sh) / 2;
  }

  typed._derivedImageTexture = derivedTexture;
}

/**
 * Apply (or clear) the non-destructive color-correction filter for an image
 * fill. Skipped entirely (`filters = null`) when `adjustments` is absent/
 * all-zero, both as a perf fast-path and so an unadjusted export is
 * pixel-identical to before this feature existed. The matrix itself comes
 * from the pure, unit-tested `buildAdjustmentColorMatrix` — this function is
 * the only place that touches the WebGL filter object.
 */
function applyImageAdjustments(sprite: Sprite, adjustments: ImageAdjustments | undefined): void {
  if (isDefaultAdjustments(adjustments)) {
    sprite.filters = null;
    return;
  }
  const filter = new ColorMatrixFilter();
  filter.matrix = buildAdjustmentColorMatrix(adjustments!) as ColorMatrixFilter["matrix"];
  sprite.filters = [filter];
}

function addImageSprite(
  container: Container,
  texture: Texture,
  imageFill: ImageFill,
  containerW: number,
  containerH: number,
  cornerRadius?: number,
  cornerRadiusPerCorner?: PerCornerRadius,
  cornerSmoothing?: number,
): void {
  // Remove any existing image sprite first
  destroyImageSprite(container);

  const sprite = new Sprite(texture);
  sprite.label = "image-fill";
  scaleImageSprite(sprite, texture, imageFill, containerW, containerH);
  applyImageAdjustments(sprite, imageFill.adjustments);

  // Apply mask for clipping (cornerRadius or bounds)
  if (hasPerCornerRadius(cornerRadiusPerCorner) || (cornerRadius && cornerRadius > 0)) {
    const mask = new Graphics();
    mask.label = "image-mask";
    drawRoundedShape(mask, containerW, containerH, cornerRadius, cornerRadiusPerCorner, cornerSmoothing);
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

  appliedImageFillByContainer.set(container, {
    url: imageFill.url,
    width: containerW,
    height: containerH,
  });
}

export function applyImageFillEllipse(
  container: Container,
  imageFill: ImageFill | undefined,
  width: number,
  height: number,
): void {
  const handled = trySvgResizeFastPath(
    container,
    imageFill,
    width,
    height,
    () => applyImageFillEllipse(container, imageFill, width, height),
    (mask) => {
      mask.ellipse(width / 2, height / 2, width / 2, height / 2);
      mask.fill(0xffffff);
    },
  );
  if (handled) return;

  // Full path: clear any pending re-render, then rebuild the sprite immediately.
  const pending = pendingSvgRerenderByContainer.get(container);
  if (pending) {
    clearTimeout(pending);
    pendingSvgRerenderByContainer.delete(container);
  }

  // Remove existing
  destroyImageSprite(container);
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
  destroyImageSprite(container);

  const sprite = new Sprite(texture);
  sprite.label = "image-fill";
  scaleImageSprite(sprite, texture, imageFill, containerW, containerH);
  applyImageAdjustments(sprite, imageFill.adjustments);

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

  appliedImageFillByContainer.set(container, {
    url: imageFill.url,
    width: containerW,
    height: containerH,
  });
}

export function updateImageFillResolution(
  container: Container,
  node: FlatSceneNode,
): void {
  // Cheap bail-out first: this runs for every registered node on each
  // zoom-resolution step, and most nodes carry no image fill source at all.
  if (!node.fills && !node.imageFill) return;

  // Re-apply image fills only when at least one SVG tile source is present
  // (raster textures don't need a resolution-driven re-rasterization).
  const hasSvgImage = getSpritePaints(node).some((p) => isSvgUrl(spritePaintUrl(p)));
  if (!hasSvgImage) return;

  if (node.type === "ellipse") {
    applyImageFillsEllipse(container, node, node.width, node.height);
    return;
  }

  if (node.type === "rect") {
    applyImageFills(
      container,
      node,
      node.width,
      node.height,
      node.cornerRadius,
      node.cornerRadiusPerCorner,
      node.cornerSmoothing,
    );
    return;
  }

  if (node.type === "frame") {
    const effectiveWidth = (container as { _effectiveWidth?: number })._effectiveWidth ?? node.width;
    const effectiveHeight = (container as { _effectiveHeight?: number })._effectiveHeight ?? node.height;
    applyImageFills(
      container,
      node,
      effectiveWidth,
      effectiveHeight,
      node.cornerRadius,
      node.cornerRadiusPerCorner,
      node.cornerSmoothing,
    );
  }
}

// ---------------------------------------------------------------------------
// Multiple image paints (Figma-style paint stack)
//
// All image sprites are drawn ABOVE the Graphics-based fills (solid/gradient),
// preserving their mutual bottom-to-top order and per-layer opacity. When the
// stack has 0 or 1 image paint we delegate to the legacy single-sprite path so
// the SVG resize fast-path and texture cache behave exactly as before. With 2+
// image paints we render an indexed sprite per paint (fast-path skipped).
// ---------------------------------------------------------------------------

const MULTI_IMAGE_LABEL_PREFIX = "image-fill-";
const MULTI_IMAGE_MASK_PREFIX = "image-mask-";

/** Paints rendered as sprites: image (Sprite) and pattern (TilingSprite). */
type SpritePaint = ImagePaint | PatternPaint;

/** Sprite-rendered paints from the node's renderable fill stack (bottom-to-top). */
function getSpritePaints(node: FlatSceneNode): SpritePaint[] {
  return getResolvedRenderableFills(node).filter(
    (p): p is SpritePaint => p.type === "image" || p.type === "pattern",
  );
}

/** Tile-source URL of a sprite paint (image url or pattern tile url). */
function spritePaintUrl(paint: SpritePaint): string {
  return paint.type === "image" ? paint.image.url : paint.pattern.url;
}

/** Last applied sprite-paint stack per container, so a size-only change can
 *  resize the existing sprites in place instead of destroy+rebuild (mirrors
 *  `restretchExistingSprite`'s single-image fast path). */
interface AppliedSpritePaints {
  paints: SpritePaint[];
  width: number;
  height: number;
}
const appliedSpritePaintsByContainer = new WeakMap<Container, AppliedSpritePaints>();

/** Reference-equal paint stacks: true when neither the paint objects nor the
 *  stack order changed — the cheap, safe signal that only size changed
 *  (scene data is replaced wholesale on any real edit, never mutated in place). */
function spritePaintsUnchanged(a: SpritePaint[], b: SpritePaint[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Redraw a paint's clip mask (if any) at the new size. */
function redrawIndexedMask(
  container: Container,
  index: number,
  width: number,
  height: number,
  ellipse: boolean,
  cornerRadius?: number,
  cornerRadiusPerCorner?: PerCornerRadius,
  cornerSmoothing?: number,
): void {
  const mask = container.getChildByLabel(`${MULTI_IMAGE_MASK_PREFIX}${index}`);
  if (!(mask instanceof Graphics)) return;
  mask.clear();
  if (ellipse) {
    mask.ellipse(width / 2, height / 2, width / 2, height / 2);
  } else {
    drawRoundedShape(mask, width, height, cornerRadius, cornerRadiusPerCorner, cornerSmoothing);
  }
  mask.fill(0xffffff);
}

/**
 * Fast path for a size-only change of the multi/pattern sprite stack:
 * resize each existing sprite in place (cheap) instead of tearing everything
 * down and re-issuing texture loads. Returns true when it handled the call
 * (including "nothing changed"), false when the caller must fall through to
 * the full rebuild (first apply, or the paint stack itself changed).
 */
function tryResizeExistingSpritePaints(
  container: Container,
  spritePaints: SpritePaint[],
  width: number,
  height: number,
  ellipse: boolean,
  cornerRadius?: number,
  cornerRadiusPerCorner?: PerCornerRadius,
  cornerSmoothing?: number,
): boolean {
  const prev = appliedSpritePaintsByContainer.get(container);
  if (!prev || !spritePaintsUnchanged(prev.paints, spritePaints)) return false;
  if (prev.width === width && prev.height === height) return true; // no-op

  for (let i = 0; i < spritePaints.length; i++) {
    const paint = spritePaints[i];
    const sprite = container.getChildByLabel(`${MULTI_IMAGE_LABEL_PREFIX}${i}`);
    if (!sprite) return false; // structural mismatch (e.g. texture still loading) — full rebuild

    if (paint.type === "pattern") {
      if (!(sprite instanceof TilingSprite)) return false;
      const p = normalizePattern(paint.pattern);
      sprite.width = width;
      sprite.height = height;
      sprite.tilePosition.set(p.offsetX, p.offsetY);
    } else {
      if (!(sprite instanceof Sprite)) return false;
      // Mirror `restretchExistingSprite`: `scaleImageSprite` may derive a new
      // cropped/cover texture, so destroy the previous derived texture (if
      // it's about to be replaced) to avoid leaking one Texture per resize tick.
      const typed = sprite as Sprite & { _baseImageTexture?: Texture; _derivedImageTexture?: Texture };
      const baseTexture = typed._baseImageTexture ?? sprite.texture;
      const prevDerived = typed._derivedImageTexture;
      scaleImageSprite(sprite, baseTexture, paint.image, width, height);
      const newDerived = typed._derivedImageTexture;
      if (prevDerived && prevDerived !== newDerived) {
        prevDerived.destroy(false);
      }
    }

    redrawIndexedMask(container, i, width, height, ellipse, cornerRadius, cornerRadiusPerCorner, cornerSmoothing);
  }

  appliedSpritePaintsByContainer.set(container, { paints: spritePaints, width, height });
  return true;
}

/** Remove all indexed multi-image sprites and their masks. */
function destroyMultiImageSprites(container: Container): void {
  for (let i = container.children.length - 1; i >= 0; i--) {
    const child = container.children[i];
    const label = child.label ?? "";
    if (label.startsWith(MULTI_IMAGE_LABEL_PREFIX) || label.startsWith(MULTI_IMAGE_MASK_PREFIX)) {
      container.removeChildAt(i);
      // Sprites and TilingSprites may carry a derived texture (cover crop or
      // baked pattern cell) that must be destroyed with the sprite.
      const derived = (child as Container & { _derivedImageTexture?: Texture })
        ._derivedImageTexture;
      if (derived) derived.destroy(false);
      child.destroy();
    }
  }
}

/**
 * Apply the node's image paint stack to a container. `ellipse` selects the
 * clip geometry: elliptical mask vs rounded-rect (cornerRadius) mask.
 */
function applyImagePaintStack(
  container: Container,
  node: FlatSceneNode,
  width: number,
  height: number,
  ellipse: boolean,
  cornerRadius?: number,
  cornerRadiusPerCorner?: PerCornerRadius,
  cornerSmoothing?: number,
): void {
  const spritePaints = getSpritePaints(node);
  const applyLegacySprite = (image: ImageFill | undefined) =>
    ellipse
      ? applyImageFillEllipse(container, image, width, height)
      : applyImageFill(container, image, width, height, cornerRadius, cornerRadiusPerCorner, cornerSmoothing);

  const single = spritePaints.length <= 1 ? spritePaints[0] : undefined;
  if (spritePaints.length <= 1 && single?.type !== "pattern") {
    // Single (or no) image: legacy fast path + cache parity.
    appliedSpritePaintsByContainer.delete(container);
    destroyMultiImageSprites(container);
    applyLegacySprite(single?.image);
    applyImagePaintProps(container, "image-fill", single);
    return;
  }

  // Multiple sprite paints (or any pattern paint): a size-only change of the
  // same stack resizes the existing sprites in place instead of destroying
  // and re-issuing texture loads for every resize tick.
  if (
    tryResizeExistingSpritePaints(
      container,
      spritePaints,
      width,
      height,
      ellipse,
      cornerRadius,
      cornerRadiusPerCorner,
      cornerSmoothing,
    )
  ) {
    return;
  }

  // Clear the legacy single sprite and render indexed sprites from scratch.
  applyLegacySprite(undefined);
  destroyMultiImageSprites(container);

  spritePaints.forEach((paint, index) => {
    const url = spritePaintUrl(paint);
    if (!url) return; // e.g. a pattern paint before its tile is uploaded
    const onTexture = (texture: Texture) => {
      addIndexedImageSprite(
        container,
        texture,
        paint,
        index,
        spritePaints.length,
        width,
        height,
        ellipse,
        cornerRadius,
        cornerRadiusPerCorner,
        cornerSmoothing,
      );
    };
    // Pattern tiles rasterize at their own natural size (× scale), never the
    // node's fill area — see `withPatternTileTexture`.
    if (paint.type === "pattern") {
      withPatternTileTexture(url, paint.pattern, container, onTexture);
    } else {
      withTexture(url, width, height, container, onTexture);
    }
  });

  // Record the applied stack (even though sprites may still be loading
  // asynchronously) so the NEXT call — e.g. a resize tick — can recognize an
  // unchanged paint stack and take the resize fast path above.
  appliedSpritePaintsByContainer.set(container, { paints: spritePaints, width, height });
}

/** Apply the node's image paint stack to a rect/frame container. */
export function applyImageFills(
  container: Container,
  node: FlatSceneNode,
  width: number,
  height: number,
  cornerRadius?: number,
  cornerRadiusPerCorner?: PerCornerRadius,
  cornerSmoothing?: number,
): void {
  applyImagePaintStack(container, node, width, height, false, cornerRadius, cornerRadiusPerCorner, cornerSmoothing);
}

/** Apply the node's image paint stack to an ellipse container. */
export function applyImageFillsEllipse(
  container: Container,
  node: FlatSceneNode,
  width: number,
  height: number,
): void {
  applyImagePaintStack(container, node, width, height, true);
}

/** Apply per-paint alpha/blend to a sprite found by label (single-image path). */
function applyImagePaintProps(
  container: Container,
  label: string,
  paint: ImagePaint | undefined,
): void {
  const sprite = container.getChildByLabel(label);
  if (!(sprite instanceof Sprite)) return;
  sprite.alpha = paint?.opacity ?? 1;
  sprite.blendMode = resolvePaintBlendMode(paint?.blendMode);
}

function addIndexedImageSprite(
  container: Container,
  texture: Texture,
  paint: SpritePaint,
  index: number,
  count: number,
  containerW: number,
  containerH: number,
  ellipse: boolean,
  cornerRadius?: number,
  cornerRadiusPerCorner?: PerCornerRadius,
  cornerSmoothing?: number,
): void {
  let sprite: Sprite | TilingSprite;
  if (paint.type === "pattern") {
    // Pass the tile's own url as the baked-cell cache key so a resize (where
    // width/height change but the pattern params don't) hits the cache
    // instead of re-baking from scratch every tick.
    sprite = buildPatternSprite(texture, paint.pattern, containerW, containerH, paint.pattern.url);
  } else {
    sprite = new Sprite(texture);
    scaleImageSprite(sprite, texture, paint.image, containerW, containerH);
    applyImageAdjustments(sprite, paint.image.adjustments);
  }
  sprite.label = `${MULTI_IMAGE_LABEL_PREFIX}${index}`;
  sprite.alpha = paint.opacity ?? 1;
  sprite.blendMode = resolvePaintBlendMode(paint.blendMode);

  // Clip mask: ellipse, per-corner, or single corner radius. A Graphics used as
  // a mask is excluded from normal rendering, so its z-position is irrelevant —
  // append it at the end.
  if (ellipse || hasPerCornerRadius(cornerRadiusPerCorner) || (cornerRadius && cornerRadius > 0)) {
    const mask = new Graphics();
    mask.label = `${MULTI_IMAGE_MASK_PREFIX}${index}`;
    if (ellipse) {
      mask.ellipse(containerW / 2, containerH / 2, containerW / 2, containerH / 2);
    } else {
      drawRoundedShape(mask, containerW, containerH, cornerRadius, cornerRadiusPerCorner, cornerSmoothing);
    }
    mask.fill(0xffffff);
    container.addChild(mask);
    sprite.mask = mask;
  }

  // Image sprites render above the Graphics fills but BELOW the frame's
  // children. Insert just after the background (mirrors the single-image path),
  // offset by this paint's index so later paints stack on top of earlier ones.
  const bgChild = container.getChildByLabel("rect-bg") ??
    container.getChildByLabel("ellipse-bg") ??
    container.getChildByLabel("frame-bg");
  const baseIndex = bgChild ? container.getChildIndex(bgChild) + 1 : 0;
  // Skip past any already-inserted lower-index sprites to keep order stable
  // regardless of async texture load completion order.
  let insertIndex = baseIndex;
  for (let i = 0; i < count; i++) {
    if (i >= index) break;
    const lower = container.getChildByLabel(`${MULTI_IMAGE_LABEL_PREFIX}${i}`);
    if (lower) {
      const li = container.getChildIndex(lower);
      if (li + 1 > insertIndex) insertIndex = li + 1;
    }
  }
  container.addChildAt(sprite, Math.min(insertIndex, container.children.length));
}
