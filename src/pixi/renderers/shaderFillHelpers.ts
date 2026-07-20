import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { FlatSceneNode, PerCornerRadius, ShaderConfig } from "@/types/scene";
import { fillLayerInsertIndex } from "./fillLayerInsertIndex";
import { buildShapeMask } from "./shapeMask";
import { SHADER_REGISTRY } from "@/lib/shaders/registry";
import { rasterizeShader } from "@/lib/shaders/shaderRaster";
import { extractNodeImage } from "@/lib/shaders/nodeRaster";

/**
 * Applies a node's shader as a baked texture on its PixiJS container, so the
 * shader participates in the scene graph's z-order (it can sit under/between
 * other nodes) instead of floating in a DOM overlay. Mirrors the sprite
 * insertion + masking approach of `imageFillHelpers`.
 */

const SHADER_SPRITE_LABEL = "shader-fill";
const SHADER_MASK_LABEL = "shader-mask";
/** Debounce for re-baking during interactive/auto-layout resize. */
const SHADER_RESIZE_REBAKE_DEBOUNCE_MS = 180;

/** Per-container bake generation; a resolved raster is discarded if it changed. */
const generationByContainer = new WeakMap<Container, number>();
/** Pending debounced rebake per container (auto-layout resize). */
const rebakeTimerByContainer = new WeakMap<Container, ReturnType<typeof setTimeout>>();
/** True while a bake (including its bounded retry) is running for a container. */
const inFlightByContainer = new WeakMap<Container, Promise<void>>();
/**
 * Latest requested bake args for a container that arrived while a bake was
 * already in flight — each bake mounts its own offscreen WebGL context, so
 * we coalesce rapid successive requests (e.g. a resize storm) into exactly
 * one follow-up bake with the newest size, instead of starting one per call.
 */
const pendingBakeByContainer = new WeakMap<Container, { node: FlatSceneNode; width: number; height: number }>();

/** Delay before retrying a failed bake, and the shared retry-delay helper. */
const BAKE_RETRY_DELAY_MS = 300;
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bake once, and if the result is null, retry exactly once after a short
 * delay. A null result is often a transient WebGL-context-exhaustion failure
 * (browsers cap live contexts; the shader library's own getContext() call
 * fails silently once the cap is hit) rather than a permanent one — by the
 * time the retry fires, other in-flight bakes have likely released their
 * contexts. Bails early (without warning) if a newer bake or destroy already
 * superseded this attempt, via the generation counter.
 */
async function bakeWithRetry(
  shader: ShaderConfig,
  width: number,
  height: number,
  baseImage: string | undefined,
  container: Container,
  gen: number,
): Promise<Texture | null> {
  const first = await rasterizeShader(shader, width, height, baseImage);
  if (first) return first;
  if (generationByContainer.get(container) !== gen || container.destroyed) return null;

  await delay(BAKE_RETRY_DELAY_MS);
  if (generationByContainer.get(container) !== gen || container.destroyed) return null;
  // A newer request was coalesced while we waited (coalescing doesn't bump the
  // generation, so the check above can't see it). Retrying would re-bake at
  // this attempt's now-stale size and briefly place a wrong-sized sprite before
  // the follow-up corrects it — skip and let the `.finally` follow-up bake with
  // the latest args instead. Being superseded is not a final failure: no warn.
  if (pendingBakeByContainer.has(container)) return null;

  const retry = await rasterizeShader(shader, width, height, baseImage);
  if (!retry) {
    // The current total silence on bake failure made this bug invisible in
    // the wild; warn once per final failure (not per attempt) so it's diagnosable.
    console.warn(`[shaderFillHelpers] shader bake failed after retry (kind: ${shader.kind})`);
  }
  return retry;
}

type CornerNode = FlatSceneNode & {
  cornerRadius?: number;
  cornerRadiusPerCorner?: PerCornerRadius;
  cornerSmoothing?: number;
};

/** A node whose baked shader is worth rendering (own visible/enabled flags). */
function isNodeRenderable(node: FlatSceneNode): boolean {
  return node.visible !== false && node.enabled !== false;
}

/**
 * Re-bake when the shader config or box size changed, or when the node just
 * became renderable (so a node hidden at bake time bakes once shown — the bake
 * itself is skipped while hidden to avoid wasted offscreen WebGL work).
 */
export function shouldRebakeShader(node: FlatSceneNode, prev: FlatSceneNode): boolean {
  const cn = node as CornerNode;
  const cp = prev as CornerNode;
  return (
    node.shader !== prev.shader ||
    node.width !== prev.width ||
    node.height !== prev.height ||
    cn.cornerRadius !== cp.cornerRadius ||
    cn.cornerRadiusPerCorner !== cp.cornerRadiusPerCorner ||
    cn.cornerSmoothing !== cp.cornerSmoothing ||
    (isNodeRenderable(node) && !isNodeRenderable(prev))
  );
}

/**
 * True when shouldRebakeShader fired ONLY because the box size changed —
 * i.e. an interactive resize. Such changes take the cheap path
 * (resizeShaderFill: stretch now, debounced re-bake); config changes and
 * hidden→visible transitions need an immediate real bake.
 */
export function isSizeOnlyShaderChange(node: FlatSceneNode, prev: FlatSceneNode): boolean {
  return (
    node.shader === prev.shader &&
    !(isNodeRenderable(node) && !isNodeRenderable(prev)) &&
    (node.width !== prev.width || node.height !== prev.height)
  );
}

/** Remove the shader sprite + mask from a container (texture is owned by the cache). */
export function destroyShaderFill(container: Container): void {
  generationByContainer.set(container, (generationByContainer.get(container) ?? 0) + 1);
  const sprite = container.getChildByLabel(SHADER_SPRITE_LABEL);
  if (sprite) {
    const mask = (sprite as Sprite).mask;
    (sprite as Sprite).mask = null;
    container.removeChild(sprite);
    sprite.destroy({ children: true });
    if (mask instanceof Graphics) {
      container.removeChild(mask);
      mask.destroy();
    }
  }
  // Defensively drop an orphaned mask if present.
  const orphanMask = container.getChildByLabel(SHADER_MASK_LABEL);
  if (orphanMask) {
    container.removeChild(orphanMask);
    orphanMask.destroy();
  }
}

/** Build the shape mask matching the node outline at the given rendered size. */
function buildMask(node: FlatSceneNode, width: number, height: number): Graphics {
  return buildShapeMask(node, width, height, SHADER_MASK_LABEL);
}

/**
 * Insert `sprite` as the node's shader fill: sized to `width`×`height` (the
 * rendered/effective size, which for auto-layout frames differs from the stored
 * node.width/height), masked to its shape, positioned above the background/image
 * fill but below child nodes. Exported for unit testing with a stub texture.
 */
export function placeShaderSprite(
  container: Container,
  sprite: Sprite,
  node: FlatSceneNode,
  width: number = node.width,
  height: number = node.height,
): void {
  sprite.label = SHADER_SPRITE_LABEL;
  sprite.x = 0;
  sprite.y = 0;
  sprite.width = width;
  sprite.height = height;

  const mask = buildMask(node, width, height);
  const index = fillLayerInsertIndex(container);
  container.addChildAt(sprite, index);
  container.addChildAt(mask, index + 1);
  sprite.mask = mask;
}

/**
 * Cheaply resize an already-placed shader fill to a new rendered size (stretches
 * the current texture and rebuilds the mask), then schedule a debounced re-bake
 * at that size for crisp output. Used by the auto-layout resize path, where the
 * size changes without a store `node.width/height` change.
 */
export function resizeShaderFill(container: Container, node: FlatSceneNode, width: number, height: number): void {
  if (!node.shader) return;
  const sprite = container.getChildByLabel(SHADER_SPRITE_LABEL) as Sprite | null;
  if (sprite) {
    sprite.width = width;
    sprite.height = height;
    const oldMask = sprite.mask;
    if (oldMask instanceof Graphics) {
      container.removeChild(oldMask);
      oldMask.destroy();
    }
    const mask = buildMask(node, width, height);
    container.addChildAt(mask, container.getChildIndex(sprite) + 1);
    sprite.mask = mask;
  }
  const existing = rebakeTimerByContainer.get(container);
  if (existing) clearTimeout(existing);
  rebakeTimerByContainer.set(
    container,
    setTimeout(() => {
      rebakeTimerByContainer.delete(container);
      if (!container.destroyed) applyShaderFill(container, node, width, height);
    }, SHADER_RESIZE_REBAKE_DEBOUNCE_MS),
  );
}

/**
 * Bake the node's shader into a texture (async) and apply it as a masked sprite.
 * `width`/`height` are the rendered size (default the stored node size; the
 * auto-layout path passes the effective size). Safe to call on any node; a no-op
 * removal when the node has no shader.
 */
export function applyShaderFill(
  container: Container,
  node: FlatSceneNode,
  width: number = node.width,
  height: number = node.height,
): void {
  const shader = node.shader;
  if (!shader) {
    destroyShaderFill(container);
    return;
  }

  // Skip the (expensive, context-leaking) offscreen WebGL bake while the node is
  // hidden/disabled; it re-bakes when it becomes renderable (see shouldRebakeShader).
  // An existing sprite is kept — Pixi's container.visible already hides it.
  if (!isNodeRenderable(node)) return;

  // A bake is already running for this container (each mounts its own offscreen
  // WebGL context) — don't start a second one concurrently. Remember only the
  // newest request; when the in-flight bake settles it fires exactly one
  // follow-up with these latest args (see the `.finally` below).
  if (inFlightByContainer.has(container)) {
    pendingBakeByContainer.set(container, { node, width, height });
    return;
  }

  const gen = (generationByContainer.get(container) ?? 0) + 1;
  generationByContainer.set(container, gen);

  const isImageShader = SHADER_REGISTRY[shader.kind]?.category === "image";

  const run = async (): Promise<void> => {
    let baseImage: string | undefined;
    if (isImageShader) {
      // Remove any prior shader sprite so it is excluded from the base render,
      // then rasterize the node's own content as the shader's input image.
      destroyShaderFill(container);
      generationByContainer.set(container, gen);
      baseImage = (await extractNodeImage(node.id)) ?? undefined;
    }

    const texture = await bakeWithRetry(shader, width, height, baseImage, container, gen);

    // Discard results superseded by a newer bake or a destroyed container.
    if (generationByContainer.get(container) !== gen || container.destroyed) return;

    // Bake failed (unknown kind, hidden-tab, or a transient WebGL failure that
    // survived the retry): clear any stale sprite so the node degrades to
    // shader-less rather than keeping an out-of-date or wrong-shape fill stuck on it.
    if (!texture) {
      destroyShaderFill(container);
      return;
    }

    destroyShaderFill(container);
    generationByContainer.set(container, gen);
    placeShaderSprite(container, new Sprite(texture), node, width, height);
  };

  const promise = run().finally(() => {
    inFlightByContainer.delete(container);
    const pending = pendingBakeByContainer.get(container);
    if (!pending) return;
    pendingBakeByContainer.delete(container);
    if (!container.destroyed) applyShaderFill(container, pending.node, pending.width, pending.height);
  });
  inFlightByContainer.set(container, promise);
}
