import { REMOVE_BG_INPUT_SIZE, REMOVE_BG_MODEL_URL } from "./constants";

// `onnxruntime-web` (WASM runtime + model weights) is only ever needed when
// the user actually removes a background, so it must never be part of the
// main bundle / initial page load. It's imported dynamically inside
// `loadSession`/`runModel` instead of at module top level — verify with
// `npm run build` that no top-level import pulls it into an eager chunk.
type OrtModule = typeof import("onnxruntime-web");
type InferenceSession = import("onnxruntime-web").InferenceSession;

let sessionPromise: Promise<{ ort: OrtModule; session: InferenceSession }> | null = null;

async function loadSession(): Promise<{ ort: OrtModule; session: InferenceSession }> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      let ort: OrtModule;
      try {
        ort = await import("onnxruntime-web");
      } catch {
        throw new Error(
          "Background removal is unavailable: the ML runtime failed to load.",
        );
      }
      try {
        const session = await ort.InferenceSession.create(REMOVE_BG_MODEL_URL, {
          executionProviders: ["wasm"],
        });
        return { ort, session };
      } catch {
        throw new Error(
          "Background removal model could not be downloaded. Check your connection and try again.",
        );
      }
    })().catch((err) => {
      // Don't cache a failed load — a later retry (e.g. connection restored)
      // should get a fresh attempt instead of the same rejected promise.
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

async function loadImageBitmap(url: string): Promise<ImageBitmap> {
  let blob: Blob;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load image (${res.status})`);
    blob = await res.blob();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Failed to load image")) throw err;
    throw new Error("Failed to load the source image for background removal.");
  }
  return createImageBitmap(blob);
}

function preprocess(bitmap: ImageBitmap): Float32Array {
  const size = REMOVE_BG_INPUT_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  // NCHW float32, normalized to [-1, 1] (RMBG-1.4's expected preprocessing).
  const channelSize = size * size;
  const floatData = new Float32Array(3 * channelSize);
  for (let i = 0; i < channelSize; i++) {
    floatData[i] = data[i * 4] / 255 - 0.5;
    floatData[channelSize + i] = data[i * 4 + 1] / 255 - 0.5;
    floatData[channelSize * 2 + i] = data[i * 4 + 2] / 255 - 0.5;
  }
  return floatData;
}

async function runModel(bitmap: ImageBitmap): Promise<Float32Array> {
  const { ort, session } = await loadSession();
  const size = REMOVE_BG_INPUT_SIZE;
  const tensor = new ort.Tensor("float32", preprocess(bitmap), [1, 3, size, size]);
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const results = await session.run({ [inputName]: tensor });
  return results[outputName].data as Float32Array;
}

/** Resample the model's size×size mask onto the image's own dimensions and
 * write it into the image's alpha channel (nearest-neighbor, normalized to
 * the mask's own min/max so contrast doesn't depend on absolute logit scale). */
function compositeAlpha(bitmap: ImageBitmap, mask: Float32Array): Promise<Blob> {
  const { width, height } = bitmap;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);

  let min = Infinity;
  let max = -Infinity;
  for (const v of mask) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;

  const maskSize = REMOVE_BG_INPUT_SIZE;
  for (let y = 0; y < height; y++) {
    const my = Math.min(maskSize - 1, Math.floor((y / height) * maskSize));
    for (let x = 0; x < width; x++) {
      const mx = Math.min(maskSize - 1, Math.floor((x / width) * maskSize));
      const alpha = Math.round(((mask[my * maskSize + mx] - min) / range) * 255);
      imageData.data[(y * width + x) * 4 + 3] = alpha;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode the result image"));
    }, "image/png");
  });
}

/**
 * Remove the background of an image, returning a new PNG `Blob` with alpha
 * (the subject stays opaque, the background becomes transparent).
 *
 * Lazily loads `onnxruntime-web` and the model weights (see `./constants`)
 * on first call; the session is cached and reused by subsequent calls.
 * Rejects with a user-facing message on load/network/runtime failure.
 */
export async function removeBackground(imageUrl: string): Promise<Blob> {
  const bitmap = await loadImageBitmap(imageUrl);
  const mask = await runModel(bitmap);
  return compositeAlpha(bitmap, mask);
}
