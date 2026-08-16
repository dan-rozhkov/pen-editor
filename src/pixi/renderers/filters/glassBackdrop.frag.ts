/**
 * Live backdrop-material fragment shader shared by Glass and the migrated
 * background-blur (see `liveBackdropHelpers.ts`'s
 * `backgroundBlurToGlassEffect` — background blur is just a Glass params
 * tuple with refraction/dispersion/intensity/splay/vibrancy at 0 and `frost`
 * set to the blur radius).
 *
 * Tuned to read as Apple's iOS "Liquid Glass" (UIVisualEffectView-style)
 * material rather than a plain refractive-blob effect. Beyond the original
 * refraction/dispersion/frost/directional-specular terms, this adds:
 *  - `vibrancyAdjust`: saturation boost (toward ~1.8x) + a small S-curve
 *    contrast lift on the sampled backdrop, both scaled by `vibrancy`
 *    (`uLight.w`). This is the "vibrancy" look iOS materials use to make
 *    content behind the glass pop rather than just blur.
 *  - `rimTerm` (omni rim light): a thin, continuous highlight band ~1-2
 *    local px inside the shape outline, present all the way around the
 *    perimeter (not just where the directional light points) — iOS glass
 *    always shows a bright edge, unlike a single glint. Scaled by
 *    `lightIntensity`.
 *  - `bounce`: a second, weaker/broader `specular()` lobe on the side
 *    opposite `lightAngle` — real glass catches ambient light on both the
 *    lit and shadowed edges, the far one always dimmer.
 *  - `shadow`: a subtle darkening of the edge band opposite the light
 *    direction, grounding the material against its backdrop. Also scaled by
 *    `lightIntensity` so a 0 intensity stays a true no-op.
 *  - Highlights (spec + bounce + rim) are combined with a screen blend
 *    (`rgb + h*(1-rgb)`) instead of plain addition, so they roll off toward
 *    white instead of clipping.
 *
 * All of the above are driven by `vibrancy`/`lightIntensity` and collapse to
 * exactly 0 contribution when those are 0 — this is what keeps
 * `backgroundBlurToGlassEffect`'s mapping (both params zeroed) a pure
 * gaussian backdrop blur with no vibrancy/rim/specular/shadow artifacts.
 *
 * `#version 300 es` on the first line flags `GlProgram` to treat this (and
 * the paired vertex shader) as GLSL ES 300 and to insert the matching
 * version/precision headers automatically — see `GlProgram`'s constructor in
 * `node_modules/pixi.js/lib/rendering/renderers/gl/shader/GlProgram.mjs`.
 *
 * Uniform naming: `uSize`/`uRadii`/`uParams`/`uLight`/`uToLocalA`/
 * `uToLocalB`/`uWorldA`/`uWorldB`/`uIsEllipse`/`uCornerSmoothing` are the individual fields of
 * the `glassUniforms` `UniformGroup` resource (WebGL binds a non-UBO
 * `UniformGroup`'s fields as plain top-level uniforms by name, not as a
 * struct/block — see `BlendModeFilter`'s `uBlend` for precedent). `uTexture`
 * and `uBackTexture` are added automatically by `Filter`'s constructor
 * (`addResource`, `blendRequired: true`). `uFrostTexture` is our own texture
 * resource, swapped between the raw back texture and a blurred copy
 * per-apply by `GlassBackdropFilter`. `uOutputFrame`/`uInputSize`/
 * `uInputClamp` are global filter uniforms (see the vertex shader's doc
 * comment), declared here because this file also reads them — critically,
 * `FilterSystem` binds them with the *actual* post-clip, post-rounding
 * values for this draw (see `GlassBackdropFilter.writeLocalMatrix`'s doc
 * comment for why the CPU side can neither compute nor read these itself).
 *
 * ALPHA-GATED COMPOSITE: `main`'s final line multiplies the whole result
 * (color AND alpha) by the un-dispersed centre sample's alpha
 * (`sampleDispersed`'s `.a`). This is what makes the material render as
 * fully transparent — not opaque black — wherever there's genuinely nothing
 * behind the node: an offscreen/extract render target (screenshots,
 * thumbnails, PNG/PDF export) or empty on-screen canvas
 * (`backgroundAlpha: 0`) both leave the copied backdrop region's content
 * empty even though the back texture itself is a normal, real allocation —
 * see `GlassBackdropFilter`'s doc comment for why this can't be detected on
 * the CPU side instead.
 */
export const glassBackdropFrag = /* glsl */ `#version 300 es
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uBackTexture;
uniform sampler2D uFrostTexture;

uniform vec4 uOutputFrame;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;

// glassUniforms
uniform vec2 uSize;      // node w,h in local logical px
uniform vec4 uRadii;     // corner radii TL,TR,BR,BL in local px
uniform vec4 uParams;    // refraction, depth(px), dispersion, splay
uniform vec4 uLight;     // cos(angle), sin(angle), intensity, vibrancy
uniform vec3 uToLocalA;  // inverse(worldTransform) row 0: global(x,y,1) -> local px
uniform vec3 uToLocalB;  // inverse(worldTransform) row 1
uniform vec2 uWorldA;    // forward worldTransform LINEAR row 0 (no translation): local-px delta -> global-px delta
uniform vec2 uWorldB;    // forward worldTransform LINEAR row 1
uniform float uIsEllipse;
uniform float uCornerSmoothing; // 0..1, mirrors the node's cornerSmoothing (squircle) fraction

// --- shapeProfile: signed distance to the node outline, in local px (negative inside) ---

float sdRoundedBoxProfile(vec2 p, vec2 halfSize, vec4 radii)
{
    // radii: TL, TR, BR, BL — picked by the quadrant p falls in.
    float r = (p.x > 0.0)
        ? ((p.y > 0.0) ? radii.z : radii.y)   // right side: BR : TR
        : ((p.y > 0.0) ? radii.w : radii.x);  // left side:  BL : TL
    r = min(r, min(halfSize.x, halfSize.y));
    vec2 q = abs(p) - halfSize + r;

    // Plain Euclidean corner (n=2), bit-identical to the original formula —
    // this is the path every node without corner smoothing still takes, so
    // there is no pow()/precision cost for the common case.
    if (uCornerSmoothing <= 0.0) {
        return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
    }

    // Corner-smoothing ("squircle") case — see Finding 3: the material
    // surface itself is drawn via drawRoundedShape -> drawSquircleRoundRect
    // (fillStrokeHelpers.ts / src/lib/shapePath/squircleCorner.ts,
    // buildSquircleRectPath) whenever cornerSmoothing is set, so the rim
    // must follow that outline too, not a plain circular corner.
    //
    // This is a deliberate APPROXIMATION, not a match of that curve's exact
    // math, and that's fine for a ~1.5px rim: buildSquircleRectPath's
    // corner keeps the SAME arc radius r (its curve sits on the identical
    // circle at the exact 45-degree diagonal for every smoothing value) and
    // instead extends flat straight "wing" tangent sections *past* this
    // SDF's own r-corner cone before the (still-circular) arc begins — a
    // region max(q, 0.0) never reaches regardless of exponent. Verified
    // numerically offline (fitting a superellipse exponent against sampled
    // points of buildSquircleRectPath's corner, restricted to the
    // q.x>0 && q.y>0 cone this term actually covers): the best-fit exponent
    // stays ~2 for every smoothing value, because the true curve really is
    // circular in there — no single exponent can be exact.
    //
    // What raising the exponent DOES do is bulge this term's zero-level-set
    // outward off the circle, toward the flat edges near (but not exactly
    // at) the corner — the same direction those unreachable wings extend —
    // which closes most of the visible detachment gap Finding 3 reported,
    // at the cost of slightly over-sharpening the exact diagonal point (which
    // the real curve leaves untouched). n = 2 + 3 * smoothing is chosen to
    // land near the n~4-5 superellipse commonly cited as the closest visual
    // match for iOS's ~60%-100% corner-smoothing range — a judgment call
    // documented here, not an exact derivation.
    float n = 2.0 + 3.0 * clamp(uCornerSmoothing, 0.0, 1.0);
    vec2 qp = max(q, 0.0);
    float outside = pow(pow(qp.x, n) + pow(qp.y, n), 1.0 / n);
    return min(max(q.x, q.y), 0.0) + outside - r;
}

float sdEllipseProfile(vec2 p, vec2 r)
{
    // Gradient-corrected distance approximation (Finding 2): exact on the
    // axes and, unlike the old (length(p / r) - 1.0) * min(r.x, r.y)
    // normalized approximation, no longer blows up on an eccentric ellipse —
    // that one reduced to a hairline along the long sides but a band tens of
    // px wide near the two ends of e.g. a 400x40 ellipse, because it ignored
    // how the true distance-per-unit-of-normalized-radius varies around the
    // perimeter. This is still an approximation (only exact at the axes and
    // in the p -> 0 limit, not a true analytic ellipse distance), but it is
    // cheap (no iteration) and close enough everywhere else for a 1.5
    // screen-px rim hairline to read as constant width all the way around.
    vec2 rr = max(r, vec2(0.0001));
    vec2 q = p / rr;
    float k = length(q);
    // Centre and (degenerate, near-zero-radius) fallback: the gradient below
    // vanishes as p -> 0, so guard it explicitly rather than divide by ~0.
    if (k < 0.0001) return -min(rr.x, rr.y);
    vec2 grad = p / (rr * rr);
    float gradLen = length(grad);
    if (gradLen < 0.0001) return -min(rr.x, rr.y);
    return (k - 1.0) * k / gradLen;
}

float shapeProfile(vec2 local)
{
    vec2 halfSize = uSize * 0.5;
    vec2 p = local - halfSize;
    if (uIsEllipse > 0.5) return sdEllipseProfile(p, halfSize);
    return sdRoundedBoxProfile(p, halfSize, uRadii);
}

// --- surfaceNormal: bend direction + edge weight from the profile's gradient ---

vec2 shapeGradient(vec2 local)
{
    float eps = 1.0;
    float dx = shapeProfile(local + vec2(eps, 0.0)) - shapeProfile(local - vec2(eps, 0.0));
    float dy = shapeProfile(local + vec2(0.0, eps)) - shapeProfile(local - vec2(0.0, eps));
    vec2 g = vec2(dx, dy);
    float len = length(g);
    return len > 0.0001 ? g / len : vec2(0.0);
}

// .xy = bend direction, .z = edge weight h (0 at shape centre, 1 at the edge)
vec3 surfaceNormal(vec2 local, float depth)
{
    float d = shapeProfile(local);
    float h = clamp(1.0 + d / max(depth, 0.0001), 0.0, 1.0);
    h = h * h; // flat centre, bend concentrated near the edge
    return vec3(shapeGradient(local), h);
}

// --- refractedUv / dispersion: sample the frost texture displaced along the normal ---

// .rgb = the three dispersed channel samples; .a = the UN-dispersed centre
// sample's alpha — the right one to read as "is there actually a backdrop
// here" (see the alpha-gating note on main's composite below).
vec4 sampleDispersed(vec2 uv, vec2 dispUv, float dispersion, vec4 clampRect)
{
    const float DISPERSION_K = 0.3;

    vec2 uvG = clamp(uv + dispUv, clampRect.xy, clampRect.zw);
    vec2 uvR = clamp(uv + dispUv * (1.0 + dispersion * DISPERSION_K), clampRect.xy, clampRect.zw);
    vec2 uvB = clamp(uv + dispUv * (1.0 - dispersion * DISPERSION_K), clampRect.xy, clampRect.zw);

    vec4 centre = texture(uFrostTexture, uvG);
    return vec4(
        texture(uFrostTexture, uvR).r,
        centre.g,
        texture(uFrostTexture, uvB).b,
        centre.a
    );
}

// --- specular: directional highlight along the bent edge normal ---

float specular(vec2 normalDir, float h, vec2 lightDir, float intensity, float splay)
{
    float ndotl = max(dot(normalDir, lightDir), 0.0);
    float shininess = mix(24.0, 2.0, clamp(splay, 0.0, 1.0));
    return pow(ndotl, shininess) * h * intensity;
}

// --- vibrancyAdjust: iOS-style saturation + gentle contrast lift ---
//
// 'vibrancy' at 0 is an exact identity (both 'mix()' factors collapse to
// 1.0/0.0), so this is a true no-op for background blur ('vibrancy' always
// 0 there — see this file's doc comment).
vec3 vibrancyAdjust(vec3 rgb, float vibrancy)
{
    float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 saturated = mix(vec3(luma), rgb, mix(1.0, 1.8, vibrancy));
    vec3 sCurve = smoothstep(0.0, 1.0, saturated);
    return clamp(mix(saturated, sCurve, 0.25 * vibrancy), 0.0, 1.0);
}

// --- rimLight: thin, continuous highlight band hugging the whole outline ---
//
// Unlike 'specular()' (driven by the surface normal's alignment with the
// light direction, so it's brightest only on one side), this reads directly
// off 'shapeProfile''s signed distance so it lights the ENTIRE perimeter —
// the "always-lit edge" iOS glass shows regardless of light angle.
//
// The band is specified in SCREEN px and converted to the local px 'd' is
// measured in ('widthLocalPx' below), because that is what iOS actually
// does: the rim is a hairline of constant apparent thickness, not a feature
// of the geometry. A fixed local-px width would vanish below 1 screen px
// when zoomed out and swell into a fat white border when zoomed in.
//
// The caller clamps the converted width to two bounds, both load-bearing for
// different reasons (see the call site in 'main'):
//  - a tiny epsilon floor, purely to keep the 'smoothstep' below from
//    dividing by a literal zero width — NOT a "minimum readable rim" floor.
//    An earlier version floored at 0.5 LOCAL px, which defeated the whole
//    screen-px premise above: at 3x-plus zoom that floor is >1.5 screen px
//    already, and it only gets fatter from there — exactly the "fat white
//    border when zoomed in" bug this function's screen-px conversion exists
//    to prevent. The SDF is evaluated analytically per fragment, so a
//    sub-local-px band still resolves correctly; there is nothing this floor
//    was buying beyond avoiding a NaN/zero-width edge case.
//  - an upper bound relative to the node's own half-size (not a flat 8.0
//    local px), so a small node at low zoom can't get a rim band as wide as
//    its own half-size and wash out into a solid highlight instead of a rim.
float rimLight(float d, float widthLocalPx, float intensity)
{
    float rim = 1.0 - smoothstep(0.0, widthLocalPx, -d);
    return rim * intensity;
}

// --- screenBlend: highlight compositing that rolls off instead of clipping ---
vec3 screenBlend(vec3 base, float amount)
{
    return base + clamp(amount, 0.0, 4.0) * (1.0 - base);
}

void main(void)
{
    vec4 baseColor = texture(uTexture, vTextureCoord);
    float inputAlpha = baseColor.a;
    if (inputAlpha <= 0.0) {
        finalColor = vec4(0.0);
        return;
    }

    // Recover this fragment's GLOBAL position from Pixi's own (already
    // clip-to-viewport'd, resolution-rounded) filter uniforms, then map it
    // into the surface's local-px space via the inverse worldTransform. See
    // GlassBackdropFilter.writeLocalMatrix's doc comment for why this must
    // be done here rather than passed pre-baked from the CPU.
    vec2 globalPos = uOutputFrame.xy + vTextureCoord * uInputSize.xy;
    vec3 g1 = vec3(globalPos, 1.0);
    vec2 local = vec2(dot(uToLocalA, g1), dot(uToLocalB, g1));

    float refraction = uParams.x;
    float depth = uParams.y;
    float dispersion = uParams.z;
    float splay = uParams.w;

    float lightIntensity = uLight.z;
    float vibrancy = uLight.w;

    vec3 n = surfaceNormal(local, depth);
    vec2 normalDir = n.xy;
    float h = n.z;
    // Raw signed distance to the outline (negative inside) — used only by
    // 'rimLight', which needs a depth-independent "how close to the edge"
    // measure distinct from 'h' (which is normalized by 'depth').
    float edgeDist = shapeProfile(local);

    vec2 displacementLocalPx = normalDir * h * refraction * depth;
    // Exact per-axis local-px -> UV Jacobian: forward worldTransform (local
    // delta -> global delta), then global delta -> UV delta via uInputSize
    // (uOutputFrame/uInputSize together define global = origin + uv * size).
    vec2 displacementGlobalPx = vec2(
        dot(uWorldA, displacementLocalPx),
        dot(uWorldB, displacementLocalPx)
    );
    vec2 dispUv = displacementGlobalPx / uInputSize.xy;

    vec4 backdrop = sampleDispersed(vTextureCoord, dispUv, dispersion, uInputClamp);
    // The un-dispersed centre sample's alpha: 0 where there is genuinely
    // nothing behind this node to refract (see the composite below).
    float backAlpha = backdrop.a;

    // Directional lobe (lit edge) + a weaker, broader bounce lobe on the
    // opposite edge ('-uLight.xy') — real glass catches light on both sides
    // of the shape, the far side always dimmer/softer than the near one.
    float spec = specular(normalDir, h, uLight.xy, lightIntensity, splay);
    const float BOUNCE_INTENSITY_SCALE = 0.35;
    const float BOUNCE_SPLAY_ADD = 0.3;
    float bounce = specular(
        normalDir, h, -uLight.xy,
        lightIntensity * BOUNCE_INTENSITY_SCALE,
        min(1.0, splay + BOUNCE_SPLAY_ADD)
    );

    // Omni rim: a thin highlight around the WHOLE outline, not just the lit
    // side — see 'rimLight''s doc comment. Its width is authored in screen px
    // and converted to local px here via the forward worldTransform's own
    // column norms (the exact local-px -> global-px scale per axis, zoom
    // included), then clamped so an extreme zoom can neither erase the rim nor
    // let it eat the whole shape.
    const float RIM_INTENSITY_SCALE = 0.5;
    const float RIM_WIDTH_SCREEN_PX = 1.5;
    const float RIM_WIDTH_MIN_LOCAL_PX = 0.001;         // zero-width-smoothstep guard only, see rimLight's doc comment
    const float RIM_WIDTH_MAX_LOCAL_FRACTION = 0.25;    // vs the node's own half-size, so a tiny node can't wash out
    const float RIM_WIDTH_MAX_LOCAL_PX = 8.0;           // absolute cap for large nodes at low zoom
    float worldScale = 0.5 * (
        length(vec2(uWorldA.x, uWorldB.x)) + length(vec2(uWorldA.y, uWorldB.y))
    );
    float rimWidthUpperBound = max(
        RIM_WIDTH_MIN_LOCAL_PX,
        min(RIM_WIDTH_MAX_LOCAL_PX, min(uSize.x, uSize.y) * RIM_WIDTH_MAX_LOCAL_FRACTION)
    );
    float rimWidthLocalPx = clamp(
        RIM_WIDTH_SCREEN_PX / max(worldScale, 0.0001),
        RIM_WIDTH_MIN_LOCAL_PX,
        rimWidthUpperBound
    );
    float rim = rimLight(edgeDist, rimWidthLocalPx, lightIntensity * RIM_INTENSITY_SCALE);

    // Shadow side: subtle darkening opposite the light direction, grounding
    // the material. Scaled by 'lightIntensity' so it's a true no-op at 0.
    const float SHADOW_INTENSITY_SCALE = 0.18;
    float shadow = max(dot(normalDir, -uLight.xy), 0.0) * h * lightIntensity * SHADOW_INTENSITY_SCALE;

    vec3 tinted = vibrancyAdjust(backdrop.rgb, vibrancy);
    vec3 rgb = screenBlend(tinted, spec + bounce * 0.6 + rim);
    rgb = clamp(rgb - shadow * rgb, 0.0, 1.0);

    // Glass is a REFRACTIVE material: where there is nothing behind it,
    // there is nothing to refract, so it must composite as fully
    // transparent rather than an opaque black fill. This is not just an
    // extract/export workaround — backgroundAlpha: 0 means a glass card
    // floating over empty on-screen canvas hits this exact case too. Gating
    // by multiplying the WHOLE composite (not just rgb) also correctly
    // zeroes every highlight term (spec/bounce/rim) — there's nothing there
    // to catch a glint either. See GlassBackdropFilter's doc comment: this is done
    // here, in the shader, because the CPU side has no cheap way to inspect
    // the back texture's actual pixel contents (only its allocation, which
    // always "succeeds" even when the copied region has nothing in it).
    finalColor = vec4(rgb * inputAlpha, inputAlpha) * backAlpha;
}
`;
