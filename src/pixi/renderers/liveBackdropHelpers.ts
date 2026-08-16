import { Container, Graphics } from "pixi.js";
import type { BackgroundBlurEffect, Effect, FlatSceneNode, GlassEffect, PerCornerRadius } from "@/types/scene";
import { pickMaterialEffect, hasOpaqueEffectiveFill } from "@/utils/fillUtils";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { buildShapeMask } from "./shapeMask";
import { drawRoundedShape } from "./fillStrokeHelpers";
import { GlassBackdropFilter } from "./filters/GlassBackdropFilter";

/**
 * Lifecycle owner for the live backdrop-material surface (Glass and the
 * migrated background-blur — see `pickMaterialEffect` in `@/utils/fillUtils`
 * for the "one material slot" rule, and `backgroundBlurToGlassEffect` below
 * for how a `BackgroundBlurEffect` maps onto the same `GlassBackdropFilter`).
 *
 * Supersedes `backgroundBlurHelpers.ts`'s one-time-snapshot bake: the
 * surface is a live `GlassBackdropFilter` (`filters/GlassBackdropFilter.ts`)
 * on a `material-surface` Graphics inserted as the node's container's FIRST
 * child, so `activeBackTexture` always sees exactly what's currently painted
 * below the node — no staleness, no debounce, no `renderer.extract`
 * readback. See `filters/GlassBackdropFilter.ts` for the filter itself.
 */

const MATERIAL_SURFACE_LABEL = "material-surface";

/** The filter owned by each container's material surface, tracked outside the display list (mirrors `layerBlurFilterByContainer` in `blurHelpers.ts`). */
const filterByContainer = new WeakMap<Container, GlassBackdropFilter>();

/** Containers that already have the destroy-teardown hook registered (avoid double-attaching). */
const destroyHooked = new WeakSet<Container>();

type CornerNode = FlatSceneNode & {
  cornerRadius?: number;
  cornerRadiusPerCorner?: PerCornerRadius;
  cornerSmoothing?: number;
};

function isNodeRenderable(node: FlatSceneNode): boolean {
  return node.visible !== false && node.enabled !== false;
}

/**
 * Background blur maps onto the same `GlassBackdropFilter` as a `GlassEffect`
 * with everything but `frost` zeroed out: no refraction/dispersion/specular,
 * `depth: 1` (irrelevant when refraction is 0, but kept >= 1 per
 * `GlassEffect`'s documented range), `frost` set to the blur radius. With
 * `uParams.x`/`uParams.z`/`uLight.z`/`uLight.w` all 0 the shared shader
 * collapses to "frosted backdrop clipped to the shape" — the background-blur
 * case — via the same code path as Glass, not a branch. `vibrancy: 0` is
 * part of that same "must stay a pure gaussian blur" contract: background
 * blur must not pick up the vibrancy saturation/contrast lift either.
 */
export function backgroundBlurToGlassEffect(effect: BackgroundBlurEffect): GlassEffect {
  return {
    type: "glass",
    lightAngle: 0,
    lightIntensity: 0,
    refraction: 0,
    depth: 1,
    dispersion: 0,
    frost: effect.radius,
    splay: 0,
    vibrancy: 0,
    id: effect.id,
    visible: effect.visible,
  };
}

function toGlassEffect(effect: GlassEffect | BackgroundBlurEffect): GlassEffect {
  return effect.type === "glass" ? effect : backgroundBlurToGlassEffect(effect);
}

/**
 * True when the effect would render as a complete visual no-op (nothing
 * displaced, nothing lit, nothing blurred, no vibrancy shift) — skip the
 * filter entirely rather than pay for an identity backdrop copy.
 *
 * `vibrancy` counts: it saturates/contrast-lifts the backdrop on its own (see
 * `vibrancyAdjust` in `glassBackdrop.frag.ts`), so a glass whose only non-zero
 * param is `vibrancy` is a visible effect, not an identity copy. Omitting it
 * here would silently drop that material.
 */
function isMaterialNoOp(effect: GlassEffect): boolean {
  return (
    effect.refraction <= 0 &&
    effect.dispersion <= 0 &&
    effect.lightIntensity <= 0 &&
    effect.frost <= 0 &&
    !((effect.vibrancy ?? 0) > 0)
  );
}

/**
 * Node types whose fill paints act as a full-bbox background, so
 * `hasOpaqueEffectiveFill` proving the top fill opaque genuinely means "you
 * can't see anything painted behind this node" — `rect`/`ellipse`/`frame`
 * only.
 *
 * Everything else must NOT be gated by that check: for `text` the fill is
 * the glyph colour, not a background (an ordinary black-text node would
 * otherwise have its material silently suppressed even though the glyphs
 * cover only a few percent of the box); `path`/`polygon`/`line` fills cover
 * only the path silhouette, which can leave most of the bbox transparent;
 * and `group`/`embed`/`ref`/`connector` have no fill concept of their own
 * that `getRenderableFills` can read meaningfully. This is also a
 * regression fix versus the old baked background-blur, which rendered
 * regardless of the node's fill.
 */
function fillCoversNodeShape(node: FlatSceneNode): boolean {
  return node.type === "rect" || node.type === "ellipse" || node.type === "frame";
}

// --- useBackBuffer gating: only pay for Pixi's full-screen back-buffer
// texture + blit (GlBackBufferSystem.renderStart/renderEnd) while at least
// one material surface is actually live, instead of unconditionally on
// every document. `renderer.backBuffer.useBackBuffer` is a plain mutable
// property re-read fresh at the start of every `render()` call (see
// `GlBackBufferSystem.renderStart` in `node_modules/pixi.js/lib/rendering/
// renderers/gl/GlBackBufferSystem.mjs`) — not an init-only option — so
// flipping it at runtime is safe. Actual `app.render()` calls happen later,
// off the renderScheduler's ticker (see `renderScheduler.ts`), never
// synchronously inside the scene-graph mutation that creates/destroys a
// surface — so there is no window where a render can observe a stale value
// from before this module finished updating it.

/** Containers currently counted toward `liveMaterialSurfaceCount` (idempotency guard for the increment/decrement below). */
const countedContainers = new WeakSet<Container>();
let liveMaterialSurfaceCount = 0;

function setBackBufferEnabled(enabled: boolean): void {
  const renderer = useCanvasRefStore.getState().pixiRefs?.app?.renderer;
  if (renderer && "backBuffer" in renderer) {
    renderer.backBuffer.useBackBuffer = enabled;
  }
}

/** Mark `container` as currently hosting a live material surface. Idempotent — safe to call on every `applyMaterialSurface` success, not just on creation. */
function markMaterialSurfaceLive(container: Container): void {
  if (countedContainers.has(container)) return;
  countedContainers.add(container);
  liveMaterialSurfaceCount++;
  if (liveMaterialSurfaceCount === 1) setBackBufferEnabled(true);
}

/** Mark `container` as no longer hosting a live material surface. Idempotent. */
function markMaterialSurfaceGone(container: Container): void {
  if (!countedContainers.has(container)) return;
  countedContainers.delete(container);
  liveMaterialSurfaceCount = Math.max(0, liveMaterialSurfaceCount - 1);
  if (liveMaterialSurfaceCount === 0) setBackBufferEnabled(false);
}

/** Redraw `surface`'s geometry in place at the given size (ellipse vs rounded-rect with per-corner radii/smoothing), mirroring `buildShapeMask`'s drawing logic without replacing the Graphics instance. */
function redrawMaterialSurfaceShape(surface: Graphics, node: FlatSceneNode, width: number, height: number): void {
  surface.clear();
  if (node.type === "ellipse") {
    surface.ellipse(width / 2, height / 2, width / 2, height / 2);
  } else {
    const cn = node as CornerNode;
    drawRoundedShape(surface, width, height, cn.cornerRadius, cn.cornerRadiusPerCorner, cn.cornerSmoothing);
  }
  surface.fill(0xffffff);
}

/**
 * Register a one-time teardown for `container`'s material surface: frees the
 * owned `GlassBackdropFilter` (which frees its own `BlurFilter`).
 * `syncNodeTree`'s node-deletion path calls `container.destroy({ children:
 * true })`, which destroys the surface Graphics but NOT `container.filters`/
 * a child's `filters` array contents (Pixi 8 leaves filter objects alive —
 * see the matching comment in `blurHelpers.ts`), so without this hook every
 * deleted node that ever had a material effect leaks a filter (+ its
 * uniform group and, if frosted, a lazily-created `BlurFilter`). Guarded by
 * a WeakSet so it's only attached once per container.
 */
export function ensureMaterialDestroyHook(container: Container): void {
  if (destroyHooked.has(container)) return;
  destroyHooked.add(container);
  container.once("destroyed", () => {
    const filter = filterByContainer.get(container);
    filterByContainer.delete(container);
    filter?.destroy();
    // `destroyMaterialSurface` is NOT called on this path (Pixi has already
    // detached/destroyed the children by the time this fires), so the live
    // count needs its own decrement here too.
    markMaterialSurfaceGone(container);
  });
}

/** Remove + destroy the material surface (Graphics + its `GlassBackdropFilter`). Idempotent. */
export function destroyMaterialSurface(container: Container): void {
  const surface = container.getChildByLabel(MATERIAL_SURFACE_LABEL) as Graphics | null;
  if (surface) {
    surface.filters = [];
    container.removeChild(surface);
    surface.destroy();
  }
  const filter = filterByContainer.get(container);
  filterByContainer.delete(container);
  filter?.destroy();
  markMaterialSurfaceGone(container);
}

/**
 * Create or update `container`'s material surface from `pickMaterialEffect`.
 * Removes the surface when there is no material effect, the node isn't
 * renderable, the effect would be a visual no-op, or (for a box-filling node
 * type — see `fillCoversNodeShape`) `hasOpaqueEffectiveFill` proves the
 * node's own fill stack certainly hides it (conservative — see that
 * function's doc comment; when it can't prove opacity it returns `false`
 * and this keeps rendering).
 */
export function applyMaterialSurface(
  container: Container,
  node: FlatSceneNode,
  effects: Effect[],
  width: number = node.width,
  height: number = node.height,
): void {
  if (container.destroyed) return;

  const picked = pickMaterialEffect(effects);
  const glassEffect = picked ? toGlassEffect(picked) : undefined;

  if (
    !glassEffect ||
    !isNodeRenderable(node) ||
    isMaterialNoOp(glassEffect) ||
    (fillCoversNodeShape(node) && hasOpaqueEffectiveFill(node))
  ) {
    destroyMaterialSurface(container);
    return;
  }

  ensureMaterialDestroyHook(container);

  const existingSurface = container.getChildByLabel(MATERIAL_SURFACE_LABEL) as Graphics | null;
  let filter = filterByContainer.get(container);

  if (existingSurface && filter) {
    redrawMaterialSurfaceShape(existingSurface, node, width, height);
    if (container.getChildIndex(existingSurface) !== 0) {
      container.removeChild(existingSurface);
      container.addChildAt(existingSurface, 0);
    }
  } else {
    // Defensive: clear any half-built prior state (e.g. a surface without a
    // tracked filter) before creating a fresh pair.
    destroyMaterialSurface(container);
    filter = new GlassBackdropFilter();
    const surface = buildShapeMask(node, width, height, MATERIAL_SURFACE_LABEL);
    filter.surface = surface;
    surface.filters = [filter];
    filterByContainer.set(container, filter);
    container.addChildAt(surface, 0);
  }

  filter.updateUniforms(glassEffect, node, width, height);
  markMaterialSurfaceLive(container);
}

/**
 * Resize-only path: redraw the surface's geometry and rewrite the size/
 * radii/flags uniforms in place, without creating a second surface or
 * touching the effect params. No-op when the node has no active material
 * surface. Called from `applyLayoutSize`.
 */
export function resizeMaterialSurface(
  container: Container,
  node: FlatSceneNode,
  width: number,
  height: number,
): void {
  const surface = container.getChildByLabel(MATERIAL_SURFACE_LABEL) as Graphics | null;
  const filter = filterByContainer.get(container);
  if (!surface || !filter) return;

  redrawMaterialSurfaceShape(surface, node, width, height);
  filter.updateGeometry(node, width, height);
}

/**
 * True when the material surface needs rebuilding/updating: the effect
 * stack, box size, or shape changed, the node just became renderable, or a
 * fill-related field changed. Modeled on the deleted
 * `shouldRebakeBackgroundBlur`, but — unlike that bake-driven predicate —
 * there is no separate "size-only" variant: writing a uniform is cheap, so
 * every trigger here takes the same immediate path (`applyMaterialSurface`),
 * with no debounce.
 *
 * The fill fields (`fills`/`fill`/`fillOpacity`/`fillBinding`/
 * `gradientFill`) and `opacity` are watched because `applyMaterialSurface`
 * gates on `hasOpaqueEffectiveFill(node)` for box-filling node types
 * (`fillCoversNodeShape`): without this, a rect with Glass under an opaque
 * white fill has no surface, the user drops the fill to 50% alpha, the fill
 * repaints — but the material never comes back until the node is also
 * resized or its effect stack touched. Watched unconditionally (not gated by
 * node type here) since the check is cheap and `applyMaterialSurface` itself
 * already re-applies the type gate on every call.
 */
export function shouldUpdateMaterialSurface(node: FlatSceneNode, prev: FlatSceneNode): boolean {
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
    (isNodeRenderable(node) && !isNodeRenderable(prev)) ||
    node.opacity !== prev.opacity ||
    node.fills !== prev.fills ||
    node.fill !== prev.fill ||
    node.fillOpacity !== prev.fillOpacity ||
    node.fillBinding !== prev.fillBinding ||
    node.gradientFill !== prev.gradientFill
  );
}
