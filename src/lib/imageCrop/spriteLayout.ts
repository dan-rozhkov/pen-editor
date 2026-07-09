import type { ImageCropRect, ImageFillMode } from "@/types/scene";
import {
  cropRectToPixels,
  coverPixelRect,
  isFullCropRect,
  type PixelRect,
} from "./cropRect";

/**
 * Where a media sprite (image or video) should be placed inside its node box.
 * `frame` is the source-pixel sub-rectangle of the texture to sample (null =
 * use the whole texture); `dest` is the sprite's position/size within the
 * container box.
 */
export interface FillSpriteLayout {
  /** Source-pixel crop/cover frame, or null to use the full texture. */
  frame: PixelRect | null;
  dest: { x: number; y: number; width: number; height: number };
}

/**
 * Pure fill/fit/stretch + crop geometry shared by the image-fill Pixi renderer
 * (`imageFillHelpers.ts` `scaleImageSprite`) and the video-fill renderer
 * (`videoFillHelpers.ts`). Encodes exactly the same rules:
 *
 * - `stretch`: fill the box, sampling the crop sub-rect (or whole texture).
 * - `fill` (cover): sample the cover sub-rect *within* the crop so the box is
 *   fully covered without distortion.
 * - `fit` (contain): sample the crop (or whole texture) and letterbox it,
 *   centered, so the whole cropped region is visible.
 *
 * `sourceW`/`sourceH` are the texture's natural pixel dimensions;
 * `containerW`/`containerH` are the node box. Keeping this store/Pixi-free
 * makes it unit-testable without WebGL.
 */
export function computeFillSpriteLayout(
  mode: ImageFillMode,
  crop: ImageCropRect | undefined,
  sourceW: number,
  sourceH: number,
  containerW: number,
  containerH: number,
): FillSpriteLayout {
  const cropPx = cropRectToPixels(crop, sourceW, sourceH);
  const hasCrop = !isFullCropRect(crop);

  if (mode === "stretch") {
    return {
      frame: hasCrop ? cropPx : null,
      dest: { x: 0, y: 0, width: containerW, height: containerH },
    };
  }

  if (mode === "fill") {
    return {
      frame: coverPixelRect(cropPx, containerW, containerH),
      dest: { x: 0, y: 0, width: containerW, height: containerH },
    };
  }

  // Fit: contain within bounds, centered.
  const imgAspect = cropPx.width / cropPx.height;
  const containerAspect = containerW / containerH;
  let sw: number;
  let sh: number;
  if (imgAspect > containerAspect) {
    sw = containerW;
    sh = containerW / imgAspect;
  } else {
    sh = containerH;
    sw = containerH * imgAspect;
  }
  return {
    frame: hasCrop ? cropPx : null,
    dest: {
      x: (containerW - sw) / 2,
      y: (containerH - sh) / 2,
      width: sw,
      height: sh,
    },
  };
}
