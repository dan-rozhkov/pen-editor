import { Container, Sprite, Texture } from "pixi.js";
import type { Effect, FlatSceneNode, NoiseEffect } from "@/types/scene";
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
const MAX_NOISE_EFFECTS = 2;

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

/** JSON-ish change-detection key for a resolved noise-effect stack at a given rendered size. */
export function noiseParamsKey(effects: NoiseEffect[], width: number, height: number): string {
  const parts = effects.map((e) => [
    e.noiseType,
    e.color,
    e.secondaryColor ?? "",
    e.opacity ?? 1,
    e.noiseSize,
    e.noiseSizeY ?? e.noiseSize,
    e.density,
    e.blendMode ?? "normal",
  ]);
  return JSON.stringify([parts, width, height]);
}

/** Last-applied params key per container, for idempotent no-op re-applies. */
const lastKeyByContainer = new WeakMap<Container, string>();
/** Textures owned by the noise sprites currently on a container (freed on rebuild/destroy). */
const texturesByContainer = new WeakMap<Container, Texture[]>();
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
    const textures = texturesByContainer.get(container);
    texturesByContainer.delete(container);
    lastKeyByContainer.delete(container);
    if (textures) for (const t of textures) t.destroy(true);
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
  const textures = texturesByContainer.get(container);
  texturesByContainer.delete(container);
  if (textures) for (const t of textures) t.destroy(true);
  lastKeyByContainer.delete(container);
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
 * Apply (or clear) the node's noise/grain effect stack as masked
 * nearest-neighbor sprites on its container. Idempotent: unchanged params
 * (including size) are a no-op; changed params destroy and rebuild.
 * `effects` should already be the resolved+renderable stack (as returned by
 * `getResolvedRenderableEffects`).
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
    if (lastKeyByContainer.has(container)) clearNoiseEffects(container);
    return;
  }

  const key = noiseParamsKey(picked, width, height);
  if (lastKeyByContainer.get(container) === key) return;

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

  texturesByContainer.set(container, textures);
  lastKeyByContainer.set(container, key);
  ensureNoiseDestroyHook(container);
}
