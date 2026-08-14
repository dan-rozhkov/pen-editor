// get_screenshot returns a full-resolution PNG data URL straight from
// PixiJS's extract.base64 / the embed HTML-render path. That's overkill both
// for the network (base64 inflates size ~33%) and for the auxiliary vision
// model the backend may route it through (pen-editor-backend/src/services/vision.ts,
// see pen-editor-backend/docs/specs/2026-08-14-agent-vision-design.md) — most
// vision APIs downscale internally anyway, so shipping the original pixels
// just wastes bandwidth and time. Cap the longest side, preserving aspect
// ratio, and never upscale a smaller image.

export const MAX_SCREENSHOT_SIDE = 1400;

/**
 * Pure size computation, kept separate from the canvas/Image plumbing below
 * so it's trivially unit-testable without a real rendering pipeline (happy-dom
 * has no canvas — see src/test/setup.ts).
 */
export function computeDownscaledSize(
  width: number,
  height: number,
  maxSide: number = MAX_SCREENSHOT_SIDE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0 || longest <= maxSide) {
    // Already within budget (or degenerate input) — never upscale.
    return { width, height };
  }
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image for downscaling"));
    image.src = src;
  });
}

/**
 * Downscales a PNG/JPEG data URL so its longest side is at most `maxSide`,
 * preserving aspect ratio and never upscaling. Never throws — any failure
 * (image fails to load, canvas unavailable, dimensions unreadable) falls
 * back to returning the original `dataUrl` unchanged, since a full-resolution
 * screenshot is strictly better than a broken tool call.
 */
export async function downscaleImageDataUrl(
  dataUrl: string,
  maxSide: number = MAX_SCREENSHOT_SIDE,
): Promise<string> {
  if (typeof Image === "undefined" || typeof document === "undefined") {
    return dataUrl;
  }
  try {
    const image = await loadImage(dataUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) {
      return dataUrl;
    }
    const target = computeDownscaledSize(width, height, maxSide);
    if (target.width === width && target.height === height) {
      return dataUrl;
    }
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx || typeof ctx.drawImage !== "function") {
      return dataUrl;
    }
    // The whole point of this payload is a vision model reading small UI
    // labels off it — Chromium's default filtering aliases them noticeably at
    // the ~2.4x reduction a 2880px-wide extraction down to 1400px involves.
    // Guard the properties themselves: test doubles for the 2D context (this
    // module is exercised against a stubbed canvas — happy-dom has none) may
    // not implement them.
    if ("imageSmoothingEnabled" in ctx) {
      ctx.imageSmoothingEnabled = true;
    }
    if ("imageSmoothingQuality" in ctx) {
      ctx.imageSmoothingQuality = "high";
    }
    ctx.drawImage(image, 0, 0, target.width, target.height);
    return canvas.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}
