import { Container, Sprite, Texture } from "pixi.js";
import type { Effect, FlatSceneNode, NoiseEffect, PerCornerRadius } from "@/types/scene";
import { generateNoisePixels, hashSeed, noiseCellCounts } from "@/lib/noise/generateNoise";
import { resolvePaintBlendMode } from "./fillStrokeHelpers";
import { buildMask } from "./shaderFillHelpers";

/**
 * Renders a node's noise/grain effect stack (Figma "Noise & texture") as one
 * or two masked nearest-neighbor Sprites appended as the LAST children of the
 * node's container — above its fills and its own child nodes, matching how
 * Figma composites effects over the whole object.
 */

const NOISE_SPRITE_LABEL_PREFIX = "noise-effect-";
const NOISE_MASK_LABEL_PREFIX = "noise-mask-";
/** Figma limit: at most two noise effects render per node. */
export const MAX_NOISE_EFFECTS = 2;

/** First two visible noise effects in the stack with density > 0 (Figma limit). */
export function pickNoiseEffects(effects: Effect[]): NoiseEffect[] {
  const picked: NoiseEffect[] = [];
  for (const effect of effects) {
    if (effect.type !== "noise") continue;
    if (effect.visible === false) continue;
    if (effect.density <= 0) continue;
    picked.push(effect);
    if (picked.length >= MAX_NOISE_EFFECTS) break;
  }
  return picked;
}

/**
 * The subset of a node's shape that the noise mask depends on. Kept separate
 * from `FlatSceneNode` so `noiseParamsKey` stays a pure function of its
 * arguments rather than reaching into the node itself.
 */
export interface NoiseMaskShape {
  ellipse: boolean;
  cornerRadius?: number;
  cornerRadiusPerCorner?: PerCornerRadius;
  cornerSmoothing?: number;
}

/** Derive the mask-relevant shape fields from a node (mirrors `buildShapeMask`'s reads). */
export function getNoiseMaskShape(node: FlatSceneNode): NoiseMaskShape {
  if (node.type === "ellipse") return { ellipse: true };
  const cn = node as FlatSceneNode & {
    cornerRadius?: number;
    cornerRadiusPerCorner?: PerCornerRadius;
    cornerSmoothing?: number;
  };
  return {
    ellipse: false,
    cornerRadius: cn.cornerRadius,
    cornerRadiusPerCorner: cn.cornerRadiusPerCorner,
    cornerSmoothing: cn.cornerSmoothing,
  };
}

/**
 * JSON-ish change-detection key for a resolved noise-effect stack at a given
 * rendered size and mask shape. Uses the quantized cell-grid dimensions
 * (`noiseCellCounts`) rather than raw width/height so sub-cell size changes
 * (e.g. an interactive resize that doesn't cross a cell boundary) don't
 * invalidate the key — `applyNoiseEffects` still restretches the sprites to
 * the exact rendered size on a size-only change. Includes `shape` (corner
 * radius/smoothing, ellipse-ness) so a shape-only change also invalidates the
 * mask.
 */
export function noiseParamsKey(
  effects: NoiseEffect[],
  width: number,
  height: number,
  shape: NoiseMaskShape,
): string {
  const parts = effects.map((e) => {
    const { cellsX, cellsY } = noiseCellCounts(e, width, height);
    return [e.noiseType, e.color, e.secondaryColor ?? "", e.opacity ?? 1, cellsX, cellsY, e.density, e.blendMode ?? "normal"];
  });
  return JSON.stringify([parts, shape]);
}

/** Per-container record of the currently-applied noise sprites: cache key, last rendered size, and owned textures. */
interface NoiseApplyRecord {
  key: string;
  width: number;
  height: number;
  textures: Texture[];
}

/** Last-applied noise state per container, for idempotent no-op re-applies and cheap resizes. */
const noiseByContainer = new WeakMap<Container, NoiseApplyRecord>();
/** Containers that already have the destroy-teardown hook registered. */
const destroyHooked = new WeakSet<Container>();

/**
 * Register a one-time teardown that destroys any noise textures still owned
 * by `container` when the container itself is destroyed. `syncNodeTree`'s
 * node-deletion path calls `container.destroy({ children: true })`, which
 * destroys the sprite children but not textures we created off of a canvas —
 * without this hook every deleted node with a noise effect leaks a texture
 * (same bug-08 class as `ensureLayerBlurDestroyHook` in blurHelpers.ts).
 */
function ensureNoiseDestroyHook(container: Container): void {
  if (destroyHooked.has(container)) return;
  destroyHooked.add(container);
  container.once("destroyed", () => {
    const record = noiseByContainer.get(container);
    noiseByContainer.delete(container);
    if (record) for (const t of record.textures) t.destroy(true);
  });
}

/** Remove any existing noise sprites/masks/textures from the container. */
function clearNoiseEffects(container: Container): void {
  for (let i = 0; i < MAX_NOISE_EFFECTS; i++) {
    const sprite = container.getChildByLabel(`${NOISE_SPRITE_LABEL_PREFIX}${i}`) as Sprite | null;
    if (sprite) {
      const mask = sprite.mask;
      sprite.mask = null;
      container.removeChild(sprite);
      sprite.destroy({ children: true });
      if (mask && mask instanceof Container) {
        container.removeChild(mask);
        mask.destroy();
      }
    }
    const orphanMask = container.getChildByLabel(`${NOISE_MASK_LABEL_PREFIX}${i}`);
    if (orphanMask) {
      container.removeChild(orphanMask);
      orphanMask.destroy();
    }
  }
  const record = noiseByContainer.get(container);
  noiseByContainer.delete(container);
  if (record) for (const t of record.textures) t.destroy(true);
}

/** Build a nearest-neighbor texture for one noise effect at the given rendered size. */
function buildNoiseTexture(effect: NoiseEffect, width: number, height: number, seed: number): Texture {
  const { cellsX, cellsY } = noiseCellCounts(effect, width, height);
  const pixels = generateNoisePixels(effect, cellsX, cellsY, seed);
  const canvas = document.createElement("canvas");
  canvas.width = cellsX;
  canvas.height = cellsY;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, cellsX, cellsY), 0, 0);
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  return texture;
}

/**
 * Cheap path for a size-only change (same cache key, i.e. same effects/shape,
 * only the rendered width/height moved without crossing a noise-cell
 * boundary): restretch each existing noise sprite and rebuild its mask at the
 * new size, without regenerating textures.
 */
function resizeNoiseSprites(container: Container, node: FlatSceneNode, count: number, width: number, height: number): void {
  for (let index = 0; index < count; index++) {
    const sprite = container.getChildByLabel(`${NOISE_SPRITE_LABEL_PREFIX}${index}`) as Sprite | null;
    if (!sprite) continue;
    sprite.width = width;
    sprite.height = height;

    const oldMask = sprite.mask;
    let insertIndex = container.children.length;
    if (oldMask instanceof Container) {
      insertIndex = container.getChildIndex(oldMask);
      container.removeChild(oldMask);
      oldMask.destroy();
    }
    const mask = buildMask(node, width, height, `${NOISE_MASK_LABEL_PREFIX}${index}`);
    container.addChildAt(mask, Math.min(insertIndex, container.children.length));
    sprite.mask = mask;
  }
}

/**
 * Apply (or clear) the node's noise/grain effect stack as masked
 * nearest-neighbor sprites on its container. Idempotent: unchanged params
 * (including size and shape) are a no-op; a same-key size change restretches
 * the existing sprites and masks (no texture regen); any other change
 * destroys and rebuilds. `effects` should already be the resolved+renderable
 * stack (as returned by `getResolvedRenderableEffects`).
 */
export function applyNoiseEffects(
  container: Container,
  node: FlatSceneNode,
  effects: Effect[],
  width: number,
  height: number,
): void {
  const picked = pickNoiseEffects(effects);
  if (picked.length === 0) {
    if (noiseByContainer.has(container)) clearNoiseEffects(container);
    return;
  }

  const shape = getNoiseMaskShape(node);
  const key = noiseParamsKey(picked, width, height, shape);
  const existing = noiseByContainer.get(container);
  if (existing && existing.key === key) {
    if (existing.width !== width || existing.height !== height) {
      resizeNoiseSprites(container, node, picked.length, width, height);
      existing.width = width;
      existing.height = height;
    }
    return;
  }

  clearNoiseEffects(container);

  const textures: Texture[] = [];
  picked.forEach((effect, index) => {
    const seed = hashSeed(`${node.id}:${index}`);
    const texture = buildNoiseTexture(effect, width, height, seed);
    textures.push(texture);

    const sprite = new Sprite(texture);
    sprite.label = `${NOISE_SPRITE_LABEL_PREFIX}${index}`;
    sprite.x = 0;
    sprite.y = 0;
    sprite.width = width;
    sprite.height = height;
    sprite.blendMode = resolvePaintBlendMode(effect.blendMode);

    const mask = buildMask(node, width, height, `${NOISE_MASK_LABEL_PREFIX}${index}`);
    // Last children of the container: above fills AND above child nodes.
    container.addChild(sprite);
    container.addChild(mask);
    sprite.mask = mask;
  });

  noiseByContainer.set(container, { key, width, height, textures });
  ensureNoiseDestroyHook(container);
}
