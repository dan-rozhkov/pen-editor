import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Texture } from "pixi.js";
import { SHADER_REGISTRY } from "@/lib/shaders/registry";
import { buildShaderProps } from "@/lib/shaders/buildShaderProps";
import { createSemaphore } from "@/lib/shaders/bakeSemaphore";
import type { ShaderConfig } from "@/types/scene";

/**
 * Bakes a shader into a PixiJS texture so shader-bearing nodes render inside the
 * scene graph (and thus obey z-order) instead of floating in a DOM overlay.
 *
 * The shader is rendered offscreen by the same `@paper-design/shaders-react`
 * component the editor already uses, but frozen (`speed: 0`, `frame: 0`) to a
 * single deterministic frame and with `preserveDrawingBuffer: true` so the WebGL
 * canvas can be reliably copied into a texture. WebGL rendering cannot run under
 * happy-dom, so this module is intentionally not unit-tested (like screenshots).
 */

const CACHE_MAX_ENTRIES = 64;
const cache = new Map<string, Texture>();

/**
 * Caps concurrent offscreen bakes well under the browser's ~16-context cap.
 * Nothing previously bounded this (per-container or page-wide), so a resize
 * storm across one or more shader nodes could mount many bakes at once and
 * exhaust the cap; once exhausted, context creation fails silently and does
 * not recover on its own (see rasterizeShader's context-release comment).
 * `nodeRaster.ts`'s extractNodeImage reuses the app's existing Pixi/WebGL
 * context via renderer.extract rather than creating a new one, so it doesn't
 * need to share this semaphore.
 */
const BAKE_SEMAPHORE = createSemaphore(3);

/** djb2 hash — cheap content fingerprint for the base image data-URL. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function cacheKey(cfg: ShaderConfig, width: number, height: number, dpr: number, baseImage?: string): string {
  return [
    cfg.kind,
    JSON.stringify(cfg.params),
    cfg.preset ?? "",
    `${Math.round(width)}x${Math.round(height)}`,
    dpr,
    // Fingerprint the actual image content: two different base images of equal
    // byte length must not collide onto the same cached (wrong) texture.
    baseImage ? hashString(baseImage) : 0,
  ].join("|");
}

function remember(key: string, texture: Texture): void {
  cache.delete(key);
  cache.set(key, texture);
  // Evict oldest without destroying — live sprites may still reference the
  // texture; Pixi reclaims GPU memory once it is unreferenced.
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wall-clock cap so a bake never hangs (e.g. a throttled/background tab). */
const MAX_WAIT_MS = 1500;
/** Poll interval while waiting for the shader to size and paint. */
const POLL_MS = 32;
/** Minimum wait before accepting, so the ResizeObserver + first paint can land. */
const MIN_WAIT_MS = 120;
/** Settle time after the canvas size stabilizes, for the paint to land. */
const PAINT_SETTLE_MS = 80;
/** Consecutive stable polls required to consider the canvas sized. */
const STABLE_POLLS = 2;

/**
 * The shader library sizes its canvas from the host via a ResizeObserver and
 * paints shortly after mount. Poll (via setTimeout, which still fires when the
 * tab is backgrounded, unlike rAF) until the canvas backing store is non-zero
 * and its size has stayed stable for a couple of polls — this detects "sized &
 * painted" without assuming the final size differs from the 300×150 HTML default
 * (a node that legitimately bakes to 300×150 device px must not stall). Wall-clock
 * capped so a bake always terminates instead of hanging.
 */
async function waitForShaderCanvas(host: HTMLDivElement): Promise<HTMLCanvasElement | null> {
  const start = performance.now();
  let lastSig = "";
  let stable = 0;
  while (performance.now() - start < MAX_WAIT_MS) {
    const canvas = host.querySelector("canvas");
    if (canvas && canvas.width > 0 && canvas.height > 0) {
      const sig = `${canvas.width}x${canvas.height}`;
      if (sig === lastSig) stable++;
      else {
        stable = 0;
        lastSig = sig;
      }
      if (stable >= STABLE_POLLS && performance.now() - start >= MIN_WAIT_MS) {
        await delay(PAINT_SETTLE_MS);
        return canvas;
      }
    }
    await delay(POLL_MS);
  }
  return host.querySelector("canvas");
}

/**
 * Render `cfg` at `width × height` (device pixels via DPR) into a Pixi texture.
 * For image-filter shaders, pass the node's rasterized content as `baseImage`.
 * Returns `null` on any failure (unknown kind, zero size, capture failure) so
 * callers can degrade gracefully to a shader-less node.
 */
export async function rasterizeShader(
  cfg: ShaderConfig,
  width: number,
  height: number,
  baseImage?: string,
): Promise<Texture | null> {
  const dpr = window.devicePixelRatio || 1;
  if (width <= 0 || height <= 0) return null;

  const desc = SHADER_REGISTRY[cfg.kind];
  if (!desc) return null;

  const key = cacheKey(cfg, width, height, dpr, baseImage);
  const cached = cache.get(key);
  if (cached) {
    // Refresh LRU position.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  // Bound how many offscreen WebGL bakes run at once (see BAKE_SEMAPHORE comment).
  const release = await BAKE_SEMAPHORE.acquire();

  // Mount in-viewport but invisible: the shader library measures the host to
  // size its canvas and only paints when on-screen, so an off-screen (e.g.
  // left:-99999px) host yields a 0×0, unpainted canvas. opacity:0 keeps it
  // measurable and painted while invisible; it is removed right after capture.
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;opacity:0;pointer-events:none;z-index:-1;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  let shaderCanvas: HTMLCanvasElement | null = null;

  try {
    const props = buildShaderProps(cfg, desc.category === "image" ? baseImage : undefined);
    root.render(
      createElement(desc.Component, {
        ...props,
        speed: 0,
        frame: 0,
        width: "100%",
        height: "100%",
        webGlContextAttributes: { preserveDrawingBuffer: true },
        style: { width: "100%", height: "100%" },
      }),
    );

    // Wait for the shader canvas to size to the host and paint its frozen frame.
    shaderCanvas = await waitForShaderCanvas(host);
    // A 0-sized backing store means the shader never painted (e.g. the tab was
    // hidden while baking) — treat as failure so we don't cache a blank texture.
    if (!shaderCanvas || shaderCanvas.width === 0 || shaderCanvas.height === 0) return null;

    // Copy the WebGL frame into a 2D canvas we own. PixiJS uploads a CanvasSource
    // to the GPU lazily at first render, but the `finally` below tears the shader
    // canvas down immediately — so a texture pointing at the live WebGL canvas
    // would upload blank. The owned 2D snapshot is independent of that lifecycle.
    // resolution defaults to 1 (snapshot is already device-pixel sized), which
    // also avoids CanvasSource's resize-on-mismatch clearing the snapshot.
    const snapshot = document.createElement("canvas");
    snapshot.width = shaderCanvas.width;
    snapshot.height = shaderCanvas.height;
    const ctx = snapshot.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(shaderCanvas, 0, 0);

    const texture = Texture.from({ resource: snapshot });
    remember(key, texture);
    return texture;
  } catch {
    return null;
  } finally {
    root.unmount();
    // Explicitly free the WebGL context: browsers cap active contexts (~16) and
    // the shader library's dispose() never calls loseContext(), so without this
    // every bake leaks a context and older baked textures eventually go black.
    try {
      const gl = shaderCanvas?.getContext("webgl2") ?? shaderCanvas?.getContext("webgl");
      (gl as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      /* context already gone */
    }
    host.remove();
    // Release only after the context is torn down above, so the next queued
    // bake doesn't start while this one's context is still alive.
    release();
  }
}

/** Drop all cached baked textures (used by tests / on teardown). */
export function clearShaderRasterCache(): void {
  cache.clear();
}
