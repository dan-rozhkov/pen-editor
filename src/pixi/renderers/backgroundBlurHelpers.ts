import { BlurFilter, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import type { Effect, FlatSceneNode, PerCornerRadius } from "@/types/scene";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { drawRoundedShape } from "./fillStrokeHelpers";
import { pickBackgroundBlurRadius } from "./blurHelpers";

/**
 * Background blur ("backdrop blur" / glassmorphism): blurs whatever is
 * rendered BEHIND a node, unlike layer blur (`blurHelpers.ts`) which blurs the
 * node itself. Mirrors the baked-sprite approach of `shaderFillHelpers.ts`
 * (masked Sprite inserted into the node's own container so it obeys z-order),
 * but the source pixels come from `renderer.extract` instead of a shader.
 *
 * LIMITATION (documented per the task's allowance — PixiJS has no live
 * backdrop-filter primitive):
 *  - There is no way to sample "whatever is currently painted below this
 *    node" as a continuously-updating input the way CSS `backdrop-filter`
 *    does. This module instead takes a ONE-TIME snapshot of the stage (with
 *    this node's own container briefly hidden) cropped to the node's current
 *    axis-aligned screen bounds, blurs that snapshot, and bakes it into a
 *    static texture — mirroring the static bakes already accepted in this
 *    codebase for shaders (`shaderRaster`/`nodeRaster`, see
 *    `shaderFillHelpers.ts`).
 *  - It goes stale when content behind the node changes without this node's
 *    OWN effects/size/shape changing (no such global signal exists) — it is
 *    only re-baked per `shouldRebakeBackgroundBlur`. In practice this covers
 *    the common editing flow (add/resize/reshape the glass node) but not
 *    "something moved underneath a static glass card."
 *  - The crop rectangle is axis-aligned in stage space, so a rotated node
 *    samples an axis-aligned box rather than a rotated one — correct for the
 *    (common) unrotated case, an approximation otherwise.
 *  - Requires WebGL (`renderer.extract`), so — like `get_screenshot` and the
 *    shader bakes — this is not unit-testable; only the pure logic below
 *    (`pickBackgroundBlurRadius` in `blurHelpers.ts`, `shouldRebakeBackgroundBlur`,
 *    `placeBackgroundBlurSprite`) is covered by tests.
 */

const BACKDROP_SPRITE_LABEL = "background-blur-fill";
const BACKDROP_MASK_LABEL = "background-blur-mask";

/** Debounce for re-baking during an interactive resize drag (mirrors shaderFillHelpers). */
const BACKDROP_RESIZE_REBAKE_DEBOUNCE_MS = 180;

/** Pending debounced size-only rebake per container. */
const rebakeTimerByContainer = new WeakMap<Container, ReturnType<typeof setTimeout>>();

/**
 * The currently-baked backdrop texture owned by each container, tracked
 * independently of the display list. Needed because by the time a
 * `container.once("destroyed", ...)` handler runs, Pixi has already detached
 * and destroyed the container's children (so `getChildByLabel` can no longer
 * find the sprite to recover its texture) — see `ensureBackgroundBlurDestroyHook`.
 */
const bakedTextureByContainer = new WeakMap<Container, Texture>();

/** Containers that already have the destroy-teardown hook registered (avoid double-attaching). */
const destroyHooked = new WeakSet<Container>();

/**
 * Register a one-time teardown for `container`'s baked background-blur
 * resources: cancels any pending debounced rebake timer and frees the baked
 * sprite's texture. `syncNodeTree`'s node-deletion path destroys containers
 * with `container.destroy({ children: true })` (no `texture: true`), so
 * without this hook every deleted node that ever had a background-blur
 * effect permanently leaks one full-size GPU texture (bug-07). Guarded by a
 * WeakSet so it's only attached once per container, mirroring
 * `destroyHooked` in `videoFillHelpers.ts`.
 */
export function ensureBackgroundBlurDestroyHook(container: Container): void {
  if (destroyHooked.has(container)) return;
  destroyHooked.add(container);
  container.once("destroyed", () => {
    const timer = rebakeTimerByContainer.get(container);
    if (timer) clearTimeout(timer);
    rebakeTimerByContainer.delete(container);

    // The container's children (including the backdrop sprite) are already
    // destroyed/detached by the time this fires, so recover the texture from
    // the tracking map rather than searching the (now-empty) display list.
    const texture = bakedTextureByContainer.get(container);
    bakedTextureByContainer.delete(container);
    if (texture && !texture.destroyed) texture.destroy(true);
  });
}

type CornerNode = FlatSceneNode & {
  cornerRadius?: number;
  cornerRadiusPerCorner?: PerCornerRadius;
  cornerSmoothing?: number;
};

function isNodeRenderable(node: FlatSceneNode): boolean {
  return node.visible !== false && node.enabled !== false;
}

/**
 * Re-bake when the effect stack, box size, or shape changed, or the node just
 * became renderable — same triggers as `shouldRebakeShader`.
 */
export function shouldRebakeBackgroundBlur(node: FlatSceneNode, prev: FlatSceneNode): boolean {
  const cn = node as CornerNode;
  const cp = prev as CornerNode;
  return (
    node.effects !== prev.effects ||
    node.effect !== prev.effect ||
    node.effectStyleId !== prev.effectStyleId ||
    node.width !== prev.width ||
    node.height !== prev.height ||
    cn.cornerRadius !== cp.cornerRadius ||
    cn.cornerRadiusPerCorner !== cp.cornerRadiusPerCorner ||
    cn.cornerSmoothing !== cp.cornerSmoothing ||
    (isNodeRenderable(node) && !isNodeRenderable(prev))
  );
}

/**
 * True when `shouldRebakeBackgroundBlur` fired ONLY because the box size
 * changed — i.e. an interactive resize drag. Such changes take the cheap
 * debounced path (bake once the drag settles); effect/shape changes and
 * hidden→visible transitions need an immediate rebake. Mirrors
 * `isSizeOnlyShaderChange` in `shaderFillHelpers.ts`.
 */
export function isSizeOnlyBackgroundBlurChange(node: FlatSceneNode, prev: FlatSceneNode): boolean {
  const cn = node as CornerNode;
  const cp = prev as CornerNode;
  const nonSizeUnchanged =
    node.effects === prev.effects &&
    node.effect === prev.effect &&
    node.effectStyleId === prev.effectStyleId &&
    cn.cornerRadius === cp.cornerRadius &&
    cn.cornerRadiusPerCorner === cp.cornerRadiusPerCorner &&
    cn.cornerSmoothing === cp.cornerSmoothing &&
    !(isNodeRenderable(node) && !isNodeRenderable(prev));
  return nonSizeUnchanged && (node.width !== prev.width || node.height !== prev.height);
}

/** Build the shape mask matching the node outline at the given rendered size. */
function buildMask(node: FlatSceneNode, width: number, height: number): Graphics {
  const mask = new Graphics();
  mask.label = BACKDROP_MASK_LABEL;
  if (node.type === "ellipse") {
    mask.ellipse(width / 2, height / 2, width / 2, height / 2);
  } else {
    const cn = node as CornerNode;
    drawRoundedShape(mask, width, height, cn.cornerRadius, cn.cornerRadiusPerCorner, cn.cornerSmoothing);
  }
  mask.fill(0xffffff);
  return mask;
}

/** Remove the background-blur sprite + mask from a container (owns its baked texture). */
export function destroyBackgroundBlurFill(container: Container): void {
  const sprite = container.getChildByLabel(BACKDROP_SPRITE_LABEL) as Sprite | null;
  if (sprite) {
    const mask = sprite.mask;
    sprite.mask = null;
    container.removeChild(sprite);
    const texture = sprite.texture;
    sprite.destroy();
    if (!texture.destroyed) texture.destroy(true);
    if (bakedTextureByContainer.get(container) === texture) bakedTextureByContainer.delete(container);
    if (mask instanceof Graphics) {
      container.removeChild(mask);
      mask.destroy();
    }
  }
  // Defensively drop an orphaned mask if present.
  const orphanMask = container.getChildByLabel(BACKDROP_MASK_LABEL);
  if (orphanMask) {
    container.removeChild(orphanMask);
    orphanMask.destroy();
  }
}

/**
 * Insert `sprite` (a baked, already-blurred backdrop texture) as the node's
 * background-blur fill: positioned at local (0,0), sized to width×height,
 * masked to the node's shape, and placed as the FIRST child so it sits
 * beneath the node's own background/fill layers (which are inserted after
 * this call by the caller). Exported for unit testing with a stub texture.
 */
export function placeBackgroundBlurSprite(
  container: Container,
  sprite: Sprite,
  node: FlatSceneNode,
  width: number = node.width,
  height: number = node.height,
): void {
  sprite.label = BACKDROP_SPRITE_LABEL;
  sprite.x = 0;
  sprite.y = 0;
  sprite.width = width;
  sprite.height = height;

  const mask = buildMask(node, width, height);
  container.addChildAt(sprite, 0);
  container.addChildAt(mask, 1);
  sprite.mask = mask;
  bakedTextureByContainer.set(container, sprite.texture);
}

/**
 * Bake the content currently rendered behind `container` into a blurred
 * static texture and place it as a masked sprite at the bottom of the node's
 * own container. No-op removal when there's no visible background-blur
 * effect. See the module doc comment for the snapshot/staleness limitation.
 * Not unit-tested (needs a live WebGL renderer + a mounted container).
 */
export function applyBackgroundBlur(
  container: Container,
  node: FlatSceneNode,
  effects: Effect[],
  width: number = node.width,
  height: number = node.height,
): void {
  const radius = pickBackgroundBlurRadius(effects);
  if (radius == null || !isNodeRenderable(node) || container.destroyed) {
    destroyBackgroundBlurFill(container);
    return;
  }

  // Ensure the baked texture + any pending rebake timer are freed if this
  // container is destroyed out from under us (e.g. node deletion), same as
  // applyVideoFill's destroy hook in videoFillHelpers.ts.
  ensureBackgroundBlurDestroyHook(container);

  const app = useCanvasRefStore.getState().pixiRefs?.app;
  if (!app) return;

  const bounds = container.getBounds();
  const frame = new Rectangle(bounds.x, bounds.y, Math.max(1, bounds.width), Math.max(1, bounds.height));

  // Hide this node's own container so the snapshot only captures what's
  // behind it, then restore visibility immediately (extract renders
  // synchronously to an offscreen texture — it does not affect the on-screen
  // frame, so there's no visible flicker).
  const wasVisible = container.visible;
  container.visible = false;
  let raw: Texture | null = null;
  try {
    raw = app.renderer.extract.texture({ target: app.stage, frame });
  } catch {
    raw = null;
  } finally {
    container.visible = wasVisible;
  }
  if (!raw) {
    destroyBackgroundBlurFill(container);
    return;
  }

  // Bake the blur into a static texture (rather than a live filter) so the
  // per-frame cost is paid once, matching the static-bake precedent for
  // shader fills.
  const blurSprite = new Sprite(raw);
  const blurFilter = new BlurFilter({ strength: radius / 2, quality: 3 });
  blurSprite.filters = [blurFilter];

  let baked: Texture | null = null;
  try {
    baked = app.renderer.extract.texture({ target: blurSprite });
  } catch {
    baked = null;
  } finally {
    // Destroy the transient blur filter (a GPU resource); otherwise every
    // rebake — one per resize/shape/effect change — leaks a filter. Matches
    // applyLayerBlur's filter cleanup in blurHelpers.ts.
    blurFilter.destroy();
    blurSprite.destroy();
    raw.destroy(true);
  }

  if (!baked) {
    destroyBackgroundBlurFill(container);
    return;
  }

  destroyBackgroundBlurFill(container);
  placeBackgroundBlurSprite(container, new Sprite(baked), node, width, height);
}

/**
 * Debounced size-only rebake for an interactive resize drag: coalesces the
 * RAF-rate resize storm into a single full rebake once the drag settles, so
 * the double `renderer.extract.texture()` readback isn't paid every frame.
 * The sprite keeps its previous (now slightly wrong-sized) backdrop until the
 * timer fires — acceptable during a drag, corrected at rest. Mirrors the
 * debounced rebake in `resizeShaderFill`.
 */
export function scheduleBackgroundBlurRebake(
  container: Container,
  node: FlatSceneNode,
  effects: Effect[],
  width: number = node.width,
  height: number = node.height,
): void {
  // Registered here too (not just in applyBackgroundBlur) so a container
  // destroyed while this debounced rebake is still pending still has its
  // timer cancelled and any already-baked texture freed.
  ensureBackgroundBlurDestroyHook(container);

  const existing = rebakeTimerByContainer.get(container);
  if (existing) clearTimeout(existing);
  rebakeTimerByContainer.set(
    container,
    setTimeout(() => {
      rebakeTimerByContainer.delete(container);
      if (!container.destroyed) applyBackgroundBlur(container, node, effects, width, height);
    }, BACKDROP_RESIZE_REBAKE_DEBOUNCE_MS),
  );
}
