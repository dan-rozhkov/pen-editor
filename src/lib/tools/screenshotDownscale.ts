// get_screenshot returns a full-resolution PNG data URL straight from
// PixiJS's extract.base64 / the embed HTML-render path. That's overkill both
// for the network (base64 inflates size ~33%) and for the auxiliary vision
// model the backend may route it through (pen-editor-backend/src/services/vision.ts,
// see pen-editor-backend/docs/specs/2026-08-14-agent-vision-design.md) — most
// vision APIs downscale internally anyway, so shipping the original pixels
// just wastes bandwidth and time. Cap the longest side, preserving aspect
// ratio, and never upscale a smaller image.

export const MAX_SCREENSHOT_SIDE = 1024;

// Вложения юзера ужимаются тем же кодом, но по своему, более щедрому лимиту.
// Скриншот холста агент всегда может переснять, поэтому за него не жалко
// платить потерей деталей ради контекста; приложенный юзером референс
// переснять нельзя, и мелкий текст на макете — ровно то, ради чего его и
// приложили. Их и так не больше MAX_IMAGE_PARTS (4) на сообщение, так что
// разница в байтах между 1024 и 1400 здесь не решает.
export const MAX_ATTACHMENT_SIDE = 1400;

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

// Quality passed to toDataURL("image/webp", ...) — WebP at this quality is
// visually close to lossless for UI screenshots (flat fills, sharp text
// edges) while landing at a fraction of PNG's size, since PNG gains nothing
// from being lossless on a photographic-ish screenshot but pays for it in
// bytes. 0.85 rather than something lower: this payload exists so a vision
// model can read small UI labels off it, and WebP artifacts (unlike PNG,
// which has none) start showing as text-adjacent noise below ~0.8.
const WEBP_QUALITY = 0.85;

/**
 * Downscales a PNG/JPEG data URL so its longest side is at most `maxSide`,
 * preserving aspect ratio and never upscaling, and re-encodes it as WebP.
 * Never throws — any failure (image fails to load, canvas unavailable,
 * dimensions unreadable) falls back to returning the original `dataUrl`
 * unchanged, since a full-resolution screenshot is strictly better than a
 * broken tool call.
 *
 * Re-encoding happens even when the image is already within `maxSide` —
 * an early return here would ship that case as untouched PNG, defeating the
 * whole point of this module for every screenshot that doesn't need
 * resizing.
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
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx || typeof ctx.drawImage !== "function") {
      return dataUrl;
    }
    // The whole point of this payload is a vision model reading small UI
    // labels off it — Chromium's default filtering aliases them noticeably at
    // a several-x reduction (a 2880px-wide extraction down to 1024px, say).
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
    const encoded = canvas.toDataURL("image/webp", WEBP_QUALITY);
    // `toDataURL("image/webp")` does NOT throw or reject in a browser that
    // can't encode WebP — per spec it silently falls back to PNG, so the
    // returned string can start with "data:image/png" even though we asked
    // for WebP. That's fine (still a valid, correctly-sized data URL to
    // return), but don't assume success just because the call didn't throw:
    // check the prefix we actually got instead of trusting the request.
    if (encoded.startsWith("data:image/webp")) {
      return encoded;
    }
    if (encoded.startsWith("data:image/png")) {
      // Genuine no-WebP-support fallback. PNG at a SMALLER resolution still
      // beats the untouched original — but only then. Re-encoding an image
      // that already fit the cap produces PNG at the SAME resolution, and
      // PNG is lossless: a 500 KB phone JPEG comes back as a ~2.5 MB PNG,
      // five times the payload we were trying to shrink. Before this module
      // re-encoded in-cap images at all, that case passed through untouched;
      // keep it that way whenever the fallback fired.
      const resized = target.width !== width || target.height !== height;
      return resized ? encoded : dataUrl;
    }
    // Anything else (empty string, "data:," on a canvas with a 0 dimension,
    // etc.) is not a usable image — fall back to the original rather than
    // ship a broken data URL.
    return dataUrl;
  } catch {
    return dataUrl;
  }
}
