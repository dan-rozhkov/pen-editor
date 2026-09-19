import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { svgTextToDataUrl } from "@/lib/htmlToDesign/svgHandling";
import { getSvgIntrinsicSize } from "@/utils/svgUtils";
import { computeUniformFit, type FitResult } from "@/lib/quiverVector/fit";
import { useAiSvgPreviewStore, type AiSvgPreviewDraft } from "@/store/aiSvgPreviewStore";
import { useViewportStore } from "@/store/viewportStore";
import { drawDashedRect } from "./selectionOverlay/helpers";
import { requestCanvasRender } from "./renderScheduler";

/**
 * Draws in-flight `generate_vector` artwork on the canvas.
 *
 * The preview is a **rasterized** partial SVG rather than an incrementally
 * converted node tree. An SVG prefix is a faithful picture of what the model is
 * drawing — gradients, fill rules and strokes included — so the scene-graph
 * converter only has to be correct once, at commit, instead of on every frame.
 *
 * Previews never touch scene state; see `aiSvgPreviewStore`.
 */

/** Cap on rasterized pixels per side. A preview is transient and sits under the
 * committed vector art moments later, so there is no reason to spend a 4K
 * decode on it — and the draft re-rasterizes ~140 times over one generation. */
const MAX_RASTER_PX = 2048;

/** Same accent the `draw_vector` preview overlay uses, so in-flight agent work
 * reads as one family rather than two unrelated affordances. */
const PLACEHOLDER_COLOR = 0x0d99ff;

interface PreviewEntry {
  container: Container;
  sprite: Sprite;
  /** Dashed outline shown until the first rasterized frame replaces it. */
  placeholder: Graphics;
  /** The document this entry's texture was built from, to skip redundant work. */
  renderedSvg: string | null;
  /**
   * The uniform-fit placement for `renderedSvg`'s own intrinsic size within
   * `draft.bounds` — computed once per svg change (`getSvgIntrinsicSize` +
   * `computeUniformFit`) and reused by every `placeSprite` call in between,
   * rather than reparsing the SVG text on every viewport pan/zoom.
   */
  fit: FitResult | null;
  /** Incremented per rasterize request so stale decodes can be discarded. */
  token: number;
}

/** Exported for the regression test: verifies the devicePixelRatio multiply
 * happens before, not after, the `MAX_RASTER_PX` clamp. */
export function computeRasterScale(width: number, height: number, dpr: number): number {
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  // Applying dpr BEFORE the clamp (via Math.min against both bounds at once)
  // is what makes MAX_RASTER_PX an actual cap. The previous
  // `Math.min(1, MAX_RASTER_PX / max) * dpr` multiplied dpr in *after* the
  // clamp, so a large `width`/`height` on a high-dpr display (e.g. 4000 on a
  // 2x display: min(1, 2048/4000)=0.512, *2 = 1.024) produced a canvas
  // bigger than the cap it was supposed to enforce — 4096px (~67MB) instead
  // of the intended 2048px ceiling, re-created on every finished element.
  return Math.min(safeDpr, MAX_RASTER_PX / Math.max(width, height));
}

/**
 * Decode an SVG document into a texture.
 *
 * Returns null rather than throwing: a malformed prefix is a normal event
 * mid-stream, and a failed preview frame must not fail the generation.
 */
async function rasterizeSvg(
  svg: string,
  width: number,
  height: number,
): Promise<Texture | null> {
  if (width <= 0 || height <= 0) return null;

  const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  const scale = computeRasterScale(width, height, dpr);
  const pixelWidth = Math.max(1, Math.round(width * scale));
  const pixelHeight = Math.max(1, Math.round(height * scale));

  const image = new Image();
  image.src = svgTextToDataUrl(svg);

  try {
    // `decode()` is the whole point: handing Pixi an undecoded image yields a
    // blank texture on first paint — the same race that produced empty
    // `get_screenshot` captures.
    await image.decode();
  } catch {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  ctx.drawImage(image, 0, 0, pixelWidth, pixelHeight);

  return Texture.from({ resource: canvas, resolution: scale });
}

export function createAiSvgPreviewLayer(overlayContainer: Container): () => void {
  const root = new Container();
  root.label = "ai-svg-preview";
  overlayContainer.addChild(root);

  const entries = new Map<string, PreviewEntry>();
  let rafId: number | null = null;
  let disposed = false;

  function removeEntry(key: string): void {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    root.removeChild(entry.container);
    // The sprite owns a canvas-backed texture nothing else references.
    entry.sprite.texture?.destroy(true);
    entry.placeholder.destroy();
    entry.container.destroy({ children: true });
  }

  function placeSprite(entry: PreviewEntry, draft: AiSvgPreviewDraft): void {
    // Uniform fit, anchored at bounds.x/y — the same placement
    // `scaleAndOffsetNode` applies at commit (see `computeUniformFit`'s doc
    // comment). Falls back to stretching to `draft.bounds` only before the
    // svg's own intrinsic size is known yet (no fit computed).
    const fit = entry.fit ?? draft.bounds;
    entry.container.x = fit.x;
    entry.container.y = fit.y;
    if (entry.sprite.texture !== Texture.EMPTY) {
      entry.sprite.width = fit.width;
      entry.sprite.height = fit.height;
    }
    // Dim slightly once the real nodes are being built, so the swap from
    // raster preview to committed vector art does not read as a flash.
    entry.container.alpha = draft.phase === "committing" ? 0.6 : 1;

    // Until a frame has actually been rasterized there is nothing to show but
    // the box the artwork is going to occupy. Drawn every time because the
    // dash length is baked at the current viewport scale — without redrawing
    // on zoom the dashes would stretch (the same trap the draw_vector overlay
    // hit with its anchor markers).
    entry.placeholder.clear();
    if (entry.sprite.texture === Texture.EMPTY) {
      drawDashedRect(
        entry.placeholder,
        { x: 0, y: 0, width: fit.width, height: fit.height },
        PLACEHOLDER_COLOR,
        useViewportStore.getState().scale || 1,
      );
    }
  }

  function syncEntry(key: string, draft: AiSvgPreviewDraft): void {
    let entry = entries.get(key);
    if (!entry) {
      const container = new Container();
      const sprite = new Sprite(Texture.EMPTY);
      container.addChild(sprite);
      root.addChild(container);
      const placeholder = new Graphics();
      container.addChild(placeholder);
      entry = { container, sprite, placeholder, renderedSvg: null, fit: null, token: 0 };
      entries.set(key, entry);
    }

    placeSprite(entry, draft);
    if (entry.renderedSvg === draft.svg) return;

    entry.renderedSvg = draft.svg;
    entry.token += 1;
    if (draft.svg.length === 0) {
      // "waiting": nothing has arrived yet, so there is no document to
      // rasterize — the dashed box drawn above is the whole frame.
      return;
    }
    const token = entry.token;
    const current = entry;

    const intrinsic = getSvgIntrinsicSize(draft.svg) ?? { width: draft.bounds.width, height: draft.bounds.height };
    current.fit = computeUniformFit(intrinsic.width, intrinsic.height, draft.bounds);
    // Reposition/resize immediately with the fresh fit, even before the
    // texture has decoded — otherwise a stretched placeholder box would
    // show for the ~1-frame gap until rasterizeSvg resolves.
    placeSprite(current, draft);

    void rasterizeSvg(draft.svg, current.fit.width, current.fit.height).then(
      (texture) => {
        if (texture === null) return;
        // The layer may have been torn down, the call finalized, or a newer
        // frame already requested while this one decoded.
        if (disposed || current.token !== token || entries.get(key) !== current) {
          texture.destroy(true);
          return;
        }
        const previous = current.sprite.texture;
        current.sprite.texture = texture;
        if (previous !== Texture.EMPTY) previous?.destroy(true);
        const latest = useAiSvgPreviewStore.getState().drafts[key];
        if (latest) placeSprite(current, latest);
        // This mutation happens outside a store flush, so the canvas will not
        // repaint on its own.
        requestCanvasRender();
      },
    );
  }

  function flush(): void {
    rafId = null;
    const { drafts } = useAiSvgPreviewStore.getState();

    for (const key of [...entries.keys()]) {
      if (!(key in drafts)) removeEntry(key);
    }
    for (const [key, draft] of Object.entries(drafts)) {
      syncEntry(key, draft);
    }
  }

  function scheduleFlush(): void {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(flush);
  }

  const unsubscribe = useAiSvgPreviewStore.subscribe(scheduleFlush);
  // Sprites are placed in scene coordinates, but the rasterization budget is
  // chosen from the on-screen size; a zoom while a preview is staged should
  // reposition it with the rest of the overlay.
  const unsubscribeViewport = useViewportStore.subscribe(scheduleFlush);

  flush();

  return () => {
    disposed = true;
    unsubscribe();
    unsubscribeViewport();
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (const key of [...entries.keys()]) removeEntry(key);
    overlayContainer.removeChild(root);
    root.destroy();
  };
}
