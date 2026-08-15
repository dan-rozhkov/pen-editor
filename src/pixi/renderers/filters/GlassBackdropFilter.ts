import {
  BlurFilter,
  Filter,
  GlProgram,
  Texture,
  TexturePool,
  type Container,
  type FilterSystem,
  type RenderSurface,
} from "pixi.js";
import type { FlatSceneNode, GlassEffect } from "@/types/scene";
import {
  computeMaterialSurfacePadding,
  createGlassUniformGroup,
  writeGlassEffectUniforms,
  writeGlassGeometryUniforms,
  type GlassUniformGroup,
} from "../glassEffectHelpers";
import { glassBackdropVert } from "./glassBackdrop.vert";
import { glassBackdropFrag } from "./glassBackdrop.frag";

/**
 * Live backdrop-material filter: Glass and the migrated background-blur both
 * render through this one filter (see `liveBackdropHelpers.ts`'s
 * `backgroundBlurToGlassEffect`). Owns exactly one `BlurFilter` instance for
 * the "frost" pre-blur pass — created lazily, destroyed with this filter —
 * because Pixi filters carry per-apply GPU state and must not be shared
 * across concurrently-live material surfaces.
 *
 * Requires `renderer.backBuffer.useBackBuffer` to be `true` at render time —
 * see `blendRequired` on the `Filter` base class. `liveBackdropHelpers.ts`
 * flips that flag on/off itself, ref-counted by live material-surface count
 * (see its `markMaterialSurfaceLive`/`markMaterialSurfaceGone`); it is NOT a
 * permanent renderer init option.
 *
 * KNOWN LIMITATION — offscreen/extract render targets, and any node with
 * genuinely nothing behind it (including `backgroundAlpha: 0` empty canvas,
 * which `PixiCanvas.tsx` uses), yield a back texture whose CONTENT is empty
 * even though the texture object itself is a normal, successfully-allocated
 * one. This was originally (wrongly) handled as a CPU-side check in
 * `apply()` below — measured and disproved: `renderer.extract.*` (the
 * internal path is `FilterSystem.generateFilteredTexture`,
 * `node_modules/pixi.js/lib/filters/FilterSystem.mjs`) really does call
 * `getBackTexture()` and get back a real, distinct, successfully-copied
 * texture — `blendRequired` is honored — it's just that the copied REGION
 * has nothing drawn into it, which no identity/reference check on the CPU
 * can see. The actual fix lives in the fragment shader
 * (`glassBackdrop.frag.ts`): the un-dispersed centre sample's ALPHA is read
 * alongside its RGB, and the whole composite (color and alpha, so the
 * specular highlight is covered too) is multiplied by it. This is not just
 * an export workaround — Glass is a refractive material, and where there is
 * nothing behind it there is nothing to refract, so "render fully
 * transparent" is the correct semantic, not a special case. Concretely: a
 * Glass/background-blur material surface disappears rather than paints
 * opaque black wherever there's no real backdrop — offscreen/extract export
 * paths (the `get_screenshot` agent tool, `src/lib/tools/getScreenshot.ts`;
 * component-thumbnail capture, `src/lib/captureNodeScreenshot.ts`; PNG/image
 * export, `src/utils/exportUtils.ts`; PDF export,
 * `src/utils/exportPdfUtils.ts`) AND a glass card floating over empty
 * on-screen canvas, both today. No bake-on-export fallback exists yet;
 * that's an intentionally separate decision, not an oversight here.
 */
export class GlassBackdropFilter extends Filter {
  /**
   * The `material-surface` Graphics this filter is applied to. Set by
   * `liveBackdropHelpers.ts` right after construction — needed at apply()
   * time to read the live `worldTransform` (both directions — see
   * `writeLocalMatrix`).
   */
  surface: Container | null = null;

  private readonly glassUniforms: GlassUniformGroup;
  private frostStrength = 0;
  private blur: BlurFilter | null = null;
  private warnedNoBackTexture = false;

  constructor() {
    const glassUniforms = createGlassUniformGroup();
    super({
      glProgram: GlProgram.from({
        vertex: glassBackdropVert,
        fragment: glassBackdropFrag,
      }),
      blendRequired: true,
      resources: {
        glassUniforms,
        uFrostTexture: Texture.EMPTY.source,
      },
    });
    this.glassUniforms = glassUniforms;
  }

  /**
   * Write the effect params + this node's geometry into the uniform group in
   * place. Cheap — no reallocation — so callers may invoke this on every
   * relevant scene change with no debounce.
   *
   * Also sets `this.padding` from `computeMaterialSurfacePadding` — this is
   * the ONLY place padding is written, so every path that can change
   * `refraction`/`depth`/`dispersion`/`frost` (i.e. every call to
   * `applyMaterialSurface`) re-derives it. `resizeMaterialSurface`'s
   * `updateGeometry` deliberately does NOT touch padding: a pure resize
   * can't change those params, and recomputing it there would just repeat
   * the same value every drag frame for no reason.
   */
  updateUniforms(effect: GlassEffect, node: FlatSceneNode, width: number, height: number): void {
    writeGlassEffectUniforms(this.glassUniforms, effect, node, width, height);
    this.frostStrength = Math.max(0, effect.frost);
    this.padding = computeMaterialSurfacePadding(effect);
  }

  /**
   * Resize-only counterpart to `updateUniforms`: rewrites `uSize`/`uRadii`/
   * `uIsEllipse` without touching the effect params — used by
   * `resizeMaterialSurface`, which (unlike `applyMaterialSurface`) doesn't
   * have the current effect stack at hand and shouldn't need it for a pure
   * size change.
   */
  updateGeometry(node: FlatSceneNode, width: number, height: number): void {
    writeGlassGeometryUniforms(this.glassUniforms, node, width, height);
  }

  override apply(filterManager: FilterSystem, input: Texture, output: RenderSurface, clearMode: boolean): void {
    const back = filterManager.activeBackTexture;
    // Purely defensive, NOT the fix for the offscreen/extract empty-backdrop
    // case (see this class's doc comment) — measured and confirmed that
    // does not land here: `generateFilteredTexture` still honors
    // `blendRequired` and calls `getBackTexture()`, which returns a real,
    // distinct, successfully-allocated texture whose CONTENT happens to be
    // empty. Identity/reference comparisons on the CPU cannot see that; the
    // real gating is alpha-based, in `glassBackdrop.frag.ts`'s composite.
    // This branch only catches `activeBackTexture` being truly absent
    // (`FilterSystem`'s typing allows `undefined`) or still the untouched
    // `Texture.EMPTY` singleton `filterData.backTexture` starts as — neither
    // observed on the real render paths this repo exercises, but cheap
    // insurance against a `null`/`undefined` deref if some future Pixi
    // version or a test double ever hits it.
    if (!back || back === Texture.EMPTY || back.source === Texture.EMPTY.source) {
      if (!this.warnedNoBackTexture && import.meta.env.DEV) {
        this.warnedNoBackTexture = true;
        console.warn(
          "[GlassBackdropFilter] activeBackTexture was absent/EMPTY at apply() — rendering nothing. " +
            "This is the defensive fallback, not the offscreen/extract empty-backdrop handling (that's " +
            "alpha-gated in glassBackdrop.frag.ts and produces no warning, by design — it fires on every " +
            "ordinary export). Seeing this on the live on-screen canvas would be unexpected; check " +
            "`renderer.backBuffer.useBackBuffer` (liveBackdropHelpers.ts should have set it while any " +
            "material surface is live).",
        );
      }
      return;
    }

    this.writeLocalMatrix();

    if (this.frostStrength > 0) {
      this.blur ??= new BlurFilter({ quality: 3 });
      this.blur.strength = this.frostStrength / 2;
      const frosted = TexturePool.getSameSizeTexture(back);
      try {
        this.blur.apply(filterManager, back, frosted, true);
        this.resources.uFrostTexture = frosted.source;
        filterManager.applyFilter(this, input, output, clearMode);
      } finally {
        TexturePool.returnTexture(frosted);
      }
    } else {
      this.resources.uFrostTexture = back.source;
      filterManager.applyFilter(this, input, output, clearMode);
    }
  }

  /**
   * Write the surface's `worldTransform` (inverse + forward linear part)
   * into `uToLocalA`/`uToLocalB`/`uWorldA`/`uWorldB`. Must be recomputed
   * every apply(): `worldTransform` is only final at render time (a dragged
   * or auto-layout-repositioned node changes it every frame it moves).
   *
   * Deliberately does NOT compute or pass any bounds/origin from the CPU
   * side — an earlier version used `surface.getBounds()` for that, which is
   * wrong: `Filter.clipToViewport` defaults to `true`, so the *actual*
   * filter bounds Pixi renders with are clipped to the viewport
   * (`_calculateFilterBounds`'s `bounds.fitBounds(...)` in
   * `node_modules/pixi.js/lib/filters/FilterSystem.mjs`) and then snapped to
   * a resolution-rounded grid (`bounds.scale(resolution).ceil()...`) —
   * `getBounds()` reflects neither, so the origin (and, for a rotated node,
   * even the *width* used for a since-removed px->UV scale) would silently
   * drift once the node was partially off-screen, panned, or rotated.
   *
   * Fixed by never needing bounds on the CPU at all: `uToLocalA`/`uToLocalB`
   * carry only the pure inverse-`worldTransform` (global xy -> local px),
   * and `uWorldA`/`uWorldB` the pure forward linear part (local-px
   * displacement -> global-px displacement). The fragment shader recovers
   * the correct, already-clipped-and-rounded global position itself from
   * Pixi's own `uOutputFrame`/`uInputSize` global filter uniforms — see
   * `glassBackdrop.frag.ts`. Reading those same values here on the CPU
   * remains off the table for the reason the previous version of this
   * comment already established: this filter's `apply()` override runs
   * *before* `FilterSystem` populates its private `_filterGlobalUniforms`
   * for this draw (that happens inside `filterManager.applyFilter()`,
   * called below), so they'd be the previous filter's stale values here.
   *
   * Approximation that remains: if a glass node sits inside another
   * *filtered* container, `uOutputFrame.xy` is relative to that enclosing
   * filter's own bounds rather than absolute global space
   * (`_findPreviousFilterOffset` in `FilterSystem.mjs`), so the recovered
   * "global" position — and everything derived from it — is offset by
   * however far that ancestor's filter bounds sit from true global (0,0).
   * Not corrected for; named here rather than silently wrong.
   */
  private writeLocalMatrix(): void {
    const surface = this.surface;
    if (!surface) return;

    const inverse = surface.worldTransform.clone().invert();
    const forward = surface.worldTransform;

    const u = this.glassUniforms.uniforms;
    u.uToLocalA[0] = inverse.a;
    u.uToLocalA[1] = inverse.c;
    u.uToLocalA[2] = inverse.tx;
    u.uToLocalB[0] = inverse.b;
    u.uToLocalB[1] = inverse.d;
    u.uToLocalB[2] = inverse.ty;

    u.uWorldA[0] = forward.a;
    u.uWorldA[1] = forward.c;
    u.uWorldB[0] = forward.b;
    u.uWorldB[1] = forward.d;
  }

  override destroy(): void {
    this.blur?.destroy();
    this.blur = null;
    this.surface = null;
    super.destroy();
  }
}
