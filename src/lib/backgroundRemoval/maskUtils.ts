// Pure (DOM/WASM-free) pieces of the background-removal pipeline, extracted
// so they can be unit-tested without onnxruntime-web or a real canvas.
//
// Reference implementation: the official briaai/RMBG-1.4 model card
// (https://huggingface.co/briaai/RMBG-1.4) postprocesses the raw model
// output with min-max normalization before converting to 8-bit:
//
//   ma = torch.max(result); mi = torch.min(result)
//   result = (result - mi) / (ma - mi)
//
// `maskToAlpha` mirrors that (plus a degenerate-case guard the reference
// lacks); `maskDimsFromTensor` validates the ONNX output shape instead of
// assuming it.

import { REMOVE_BG_MAX_DIMENSION } from "./constants";

/**
 * Derive the mask's height/width from the ONNX output tensor dims, accepting
 * the canonical [1,1,H,W] as well as squeezed [1,H,W]/[H,W] variants (all
 * leading dims must be 1). Throws a clear error on anything else — never
 * silently index a flat buffer with guessed dimensions.
 */
export function maskDimsFromTensor(dims: readonly number[]): {
  height: number;
  width: number;
} {
  const fail = (): never => {
    throw new Error(
      `Background removal failed: unexpected output shape [${dims.join(", ")}] from the model.`,
    );
  };
  if (dims.length < 2 || dims.length > 4) fail();
  const leading = dims.slice(0, dims.length - 2);
  if (leading.some((d) => d !== 1)) fail();
  const height = dims[dims.length - 2];
  const width = dims[dims.length - 1];
  if (!Number.isInteger(height) || !Number.isInteger(width) || height <= 0 || width <= 0) {
    fail();
  }
  return { height, width };
}

/**
 * Resample a maskWidth×maskHeight float mask onto width×height
 * (nearest-neighbor) and min-max stretch it to 0-255 alpha values, matching
 * the official RMBG-1.4 postprocess (see module comment). A flat mask
 * (max == min — the reference formula would divide by zero) is treated as
 * fully opaque: "no confident background found" must not blank the image.
 */
export function maskToAlpha(
  mask: ArrayLike<number>,
  maskWidth: number,
  maskHeight: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;

  const alpha = new Uint8ClampedArray(width * height);
  if (range === 0) {
    alpha.fill(255);
    return alpha;
  }

  for (let y = 0; y < height; y++) {
    const my = Math.min(maskHeight - 1, Math.floor((y / height) * maskHeight));
    for (let x = 0; x < width; x++) {
      const mx = Math.min(maskWidth - 1, Math.floor((x / width) * maskWidth));
      alpha[y * width + x] = Math.round(
        ((mask[my * maskWidth + mx] - min) / range) * 255,
      );
    }
  }
  return alpha;
}

/**
 * Reject images that exceed the conservative canvas-safe size limit with a
 * clear user-facing message (instead of letting canvas ops throw opaque
 * DOMExceptions on oversized sources).
 */
export function assertImageSizeWithinLimit(width: number, height: number): void {
  if (width > REMOVE_BG_MAX_DIMENSION || height > REMOVE_BG_MAX_DIMENSION) {
    throw new Error(
      `This image is too large for background removal (${width}×${height}). ` +
        `The maximum supported size is ${REMOVE_BG_MAX_DIMENSION}px per side.`,
    );
  }
}
