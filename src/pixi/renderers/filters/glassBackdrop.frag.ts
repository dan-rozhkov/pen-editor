/**
 * Live backdrop-material fragment shader shared by Glass and the migrated
 * background-blur (see `liveBackdropHelpers.ts`'s
 * `backgroundBlurToGlassEffect` — background blur is just a Glass params
 * tuple with refraction/dispersion/intensity/splay at 0 and `frost` set to
 * the blur radius).
 *
 * `#version 300 es` on the first line flags `GlProgram` to treat this (and
 * the paired vertex shader) as GLSL ES 300 and to insert the matching
 * version/precision headers automatically — see `GlProgram`'s constructor in
 * `node_modules/pixi.js/lib/rendering/renderers/gl/shader/GlProgram.mjs`.
 *
 * Uniform naming: `uSize`/`uRadii`/`uParams`/`uLight`/`uToLocalA`/
 * `uToLocalB`/`uWorldA`/`uWorldB`/`uIsEllipse` are the individual fields of
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
uniform vec4 uLight;     // cos(angle), sin(angle), intensity, unused
uniform vec3 uToLocalA;  // inverse(worldTransform) row 0: global(x,y,1) -> local px
uniform vec3 uToLocalB;  // inverse(worldTransform) row 1
uniform vec2 uWorldA;    // forward worldTransform LINEAR row 0 (no translation): local-px delta -> global-px delta
uniform vec2 uWorldB;    // forward worldTransform LINEAR row 1
uniform float uIsEllipse;

// --- shapeProfile: signed distance to the node outline, in local px (negative inside) ---

float sdRoundedBoxProfile(vec2 p, vec2 halfSize, vec4 radii)
{
    // radii: TL, TR, BR, BL — picked by the quadrant p falls in.
    float r = (p.x > 0.0)
        ? ((p.y > 0.0) ? radii.z : radii.y)   // right side: BR : TR
        : ((p.y > 0.0) ? radii.w : radii.x);  // left side:  BL : TL
    r = min(r, min(halfSize.x, halfSize.y));
    vec2 q = abs(p) - halfSize + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float sdEllipseProfile(vec2 p, vec2 r)
{
    // Cheap normalized approximation: exact on the axes, close enough off-axis
    // for a bevel profile (not used for hard clipping — the surface's own
    // shape mask already handles that via the input alpha).
    return (length(p / max(r, vec2(0.0001))) - 1.0) * min(r.x, r.y);
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

    vec3 n = surfaceNormal(local, depth);
    vec2 normalDir = n.xy;
    float h = n.z;

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

    float spec = specular(normalDir, h, uLight.xy, uLight.z, splay);

    vec3 rgb = clamp(backdrop.rgb + vec3(spec), 0.0, 1.0);

    // Glass is a REFRACTIVE material: where there is nothing behind it,
    // there is nothing to refract, so it must composite as fully
    // transparent rather than an opaque black fill. This is not just an
    // extract/export workaround — backgroundAlpha: 0 means a glass card
    // floating over empty on-screen canvas hits this exact case too. Gating
    // by multiplying the WHOLE composite (not just rgb) also correctly
    // zeroes the specular highlight — there's nothing there to catch a
    // glint either. See GlassBackdropFilter's doc comment: this is done
    // here, in the shader, because the CPU side has no cheap way to inspect
    // the back texture's actual pixel contents (only its allocation, which
    // always "succeeds" even when the copied region has nothing in it).
    finalColor = vec4(rgb * inputAlpha, inputAlpha) * backAlpha;
}
`;
