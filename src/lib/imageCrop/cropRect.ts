import type { ImageCropRect } from "@/types/scene";

/** Identity crop: the whole source image is visible (no cropping applied). */
export const FULL_CROP_RECT: ImageCropRect = { x: 0, y: 0, width: 1, height: 1 };

/** Smallest allowed crop dimension (normalized), so a crop rect can never collapse to zero. */
const MIN_CROP_SIZE = 0.01;

/**
 * Clamp a crop rect so it always describes a valid, in-bounds sub-region of
 * the normalized 0-1 source image: width/height in `[MIN_CROP_SIZE, 1]`, and
 * x/y constrained so `x + width <= 1` / `y + height <= 1`.
 */
export function clampCropRect(crop: ImageCropRect): ImageCropRect {
  const width = Math.min(1, Math.max(MIN_CROP_SIZE, crop.width));
  const height = Math.min(1, Math.max(MIN_CROP_SIZE, crop.height));
  const x = Math.min(1 - width, Math.max(0, crop.x));
  const y = Math.min(1 - height, Math.max(0, crop.y));
  return { x, y, width, height };
}

/** True when `crop` is absent or equivalent to the identity (full image) rect. */
export function isFullCropRect(crop: ImageCropRect | undefined): boolean {
  if (!crop) return true;
  return crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Convert a normalized crop rect to pixel coordinates within a `sourceWidth`x`sourceHeight` image. */
export function cropRectToPixels(
  crop: ImageCropRect | undefined,
  sourceWidth: number,
  sourceHeight: number,
): PixelRect {
  const c = clampCropRect(crop ?? FULL_CROP_RECT);
  return {
    x: c.x * sourceWidth,
    y: c.y * sourceHeight,
    width: Math.max(1, c.width * sourceWidth),
    height: Math.max(1, c.height * sourceHeight),
  };
}

/**
 * Compute the "cover" (aspect-fill) sub-rect of `base` for a `containerW`x
 * `containerH` box — like `object-fit: cover`/`background-size: cover`, but
 * operating within an arbitrary pixel rect instead of the whole source image.
 * Used to compose crop + "fill" mode without distortion, and so a resize
 * after cropping recomputes the cover crop instead of stretching.
 */
export function coverPixelRect(base: PixelRect, containerW: number, containerH: number): PixelRect {
  const aspect = base.width / base.height;
  const containerAspect = containerW / containerH;

  if (aspect > containerAspect) {
    const width = base.height * containerAspect;
    const x = base.x + (base.width - width) / 2;
    return { x, y: base.y, width, height: base.height };
  }

  const height = base.width / containerAspect;
  const y = base.y + (base.height - height) / 2;
  return { x: base.x, y, width: base.width, height };
}

/**
 * Inverse of {@link coverPixelRect}: the "contain" (letterbox) sub-rect —
 * `base` padded (not cropped) on its shorter axis so it matches the
 * `containerW`x`containerH` aspect ratio. Used to approximate `mode: "fit"`
 * with a crop in CSS background terms: the padded rect (which may extend
 * past the original crop, i.e. pull in extra image content instead of
 * leaving empty gutters — a documented simplification, since a single CSS
 * `background-image` layer can't express true empty letterbox space around a
 * cropped sub-region) gets stretched to fill the container without
 * distortion.
 */
export function containPixelRect(base: PixelRect, containerW: number, containerH: number): PixelRect {
  const aspect = base.width / base.height;
  const containerAspect = containerW / containerH;

  if (aspect > containerAspect) {
    const height = base.width / containerAspect;
    const y = base.y - (height - base.height) / 2;
    return { x: base.x, y, width: base.width, height };
  }

  const width = base.height * containerAspect;
  const x = base.x - (width - base.width) / 2;
  return { x, y: base.y, width, height: base.height };
}

/** Pan a crop rect by a normalized (0-1 source space) delta, clamped to bounds. */
export function panCropRect(crop: ImageCropRect, dx: number, dy: number): ImageCropRect {
  return clampCropRect({ ...crop, x: crop.x + dx, y: crop.y + dy });
}

/**
 * Zoom a crop rect around its own center. `factor > 1` zooms in (shrinks the
 * visible region); `factor < 1` zooms out (grows it, clamped to the full
 * source bounds).
 */
export function zoomCropRect(crop: ImageCropRect, factor: number): ImageCropRect {
  const safeFactor = factor > 0 ? factor : 1;
  const cx = crop.x + crop.width / 2;
  const cy = crop.y + crop.height / 2;
  const width = crop.width / safeFactor;
  const height = crop.height / safeFactor;
  return clampCropRect({ x: cx - width / 2, y: cy - height / 2, width, height });
}

/**
 * Approximate a crop rect as `background-size`/`background-position` CSS
 * percentages, using the standard "oversized background + position" crop
 * technique: `background-size` scales the image up by `1/width` and
 * `1/height`, and `background-position` places the (now oversized) image so
 * the cropped region lines up with the element box. This assumes the crop
 * region is stretched to fill the element (mirrors how the Pixi renderer
 * treats `fill`/`stretch` modes with a crop applied) — a documented
 * simplification, same spirit as the existing pattern/mask CSS
 * approximations in this file's siblings.
 */
export function cropRectToBackgroundCss(
  crop: ImageCropRect | undefined,
): { size: string; position: string } {
  const c = clampCropRect(crop ?? FULL_CROP_RECT);
  const sizeX = 100 / c.width;
  const sizeY = 100 / c.height;
  const posX = c.width >= 1 ? 0 : (c.x / (1 - c.width)) * 100;
  const posY = c.height >= 1 ? 0 : (c.y / (1 - c.height)) * 100;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    size: `${round(sizeX)}% ${round(sizeY)}%`,
    position: `${round(posX)}% ${round(posY)}%`,
  };
}
