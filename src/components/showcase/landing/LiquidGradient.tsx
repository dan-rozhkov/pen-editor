import { useEffect, useRef } from "react";

/*
 * Liquid Gradient shader from the "Signale" Framer template (WebGL2, GLSL ES 3.00).
 * The fragment shader below is the template's own, ported verbatim except for the
 * mouse push buffer: the template ships with the mouse disabled, so
 * `texture(u_push_buffer, v_uv).xy` became `vec2(0.0)`.
 * Parameter values are the ones used on the live template's hero and footer.
 */

const VERTEX_SOURCE = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pixelRatio;
uniform vec4 u_colors[8];
uniform int u_colors_length;
uniform float u_seed;
uniform float u_speed;
uniform float u_loop;
uniform float u_scale;
uniform float u_turbAmp;
uniform float u_turbFreq;
uniform float u_turbIter;
uniform float u_waveFreq;
uniform float u_distBias;
uniform float u_jellify;
uniform float u_ditherMode;
uniform float u_dither;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_saturation;

// === CONSTANTS ===
const float GOLDEN_ANGLE = 2.3999632;
const float TAU = 6.28318530;

// === PCG hash - https://www.jcgt.org/published/0009/03/02/
uvec3 hash3(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    return v;
}

// Seed
vec3 seedRandom(float seedVal) {
    uvec3 s = uvec3(
        floatBitsToUint(seedVal),
        floatBitsToUint(seedVal * 1.5 + 7.31),
        floatBitsToUint(seedVal * 2.7 + 13.37)
    );
    s = hash3(s);
    return vec3(s) / float(0xFFFFFFFFu);
}

// === COLOR SPACE UTILITIES ===
vec3 toLinear(vec3 c) {
    return pow(c, vec3(2.2));
}

vec3 toSrgb(vec3 c) {
    return pow(clamp(c, 0.0, 1.0), vec3(0.4545));
}

vec3 linearToOklab(vec3 c) {
    float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
    float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
    float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;

    l = pow(max(l, 0.0), 1.0/3.0);
    m = pow(max(m, 0.0), 1.0/3.0);
    s = pow(max(s, 0.0), 1.0/3.0);

    return vec3(
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    );
}

vec3 oklabToLinear(vec3 c) {
    float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
    float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
    float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;

    l = l * l * l;
    m = m * m * m;
    s = s * s * s;

    return vec3(
        +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    );
}

vec3 oklabToLch(vec3 lab) {
    return vec3(lab.x, length(lab.yz), atan(lab.z, lab.y));
}

vec3 lchToOklab(vec3 lch) {
    return vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z));
}

vec3 mixLch(vec3 lab0, vec3 lab1, float t) {
    vec3 lch0 = oklabToLch(lab0);
    vec3 lch1 = oklabToLch(lab1);

    if (lch0.y < 0.05) lch0.z = lch1.z;
    if (lch1.y < 0.05) lch1.z = lch0.z;

    float dh = lch1.z - lch0.z;
    if (dh > 3.14159265) dh -= 6.28318530;
    if (dh < -3.14159265) dh += 6.28318530;

    return lchToOklab(vec3(
        mix(lch0.x, lch1.x, t),
        mix(lch0.y, lch1.y, t),
        lch0.z + dh * t
    ));
}

// === PALETTE SAMPLING ===
vec3 getColor(int idx) {
    if (u_colors_length < 1) return vec3(0.0);
    int safeIdx = clamp(idx, 0, u_colors_length - 1);
    return u_colors[safeIdx].rgb;
}

vec3 paletteN(float t, int count) {
    if (count < 1) return vec3(0.0);
    if (count < 2) return toLinear(getColor(0));

    float segmentSize = 1.0 / float(count - 1);
    t = clamp(t, 0.0, 1.0);
    int idx = min(int(floor(t / segmentSize)), count - 2);
    float localT = clamp((t - float(idx) * segmentSize) / segmentSize, 0.0, 1.0);

    vec3 lab0 = linearToOklab(toLinear(getColor(idx)));
    vec3 lab1 = linearToOklab(toLinear(getColor(idx + 1)));

    return oklabToLinear(mixLch(lab0, lab1, localT));
}

// === DITHER ===
float IGN(vec2 uv) {
    return fract(52.9829189 * fract(dot(uv, vec2(0.06711056, 0.00583715))));
}

float quickNoise(vec2 I) {
    return fract(sin(dot(I, vec2(12.9898, 78.233))) * 43758.5453);
}

// Dither Mode: 0=Off, 1=IGN, 2=quickNoise
float getDither(vec2 I, float mode) {
    if (mode < 0.5) return 0.5;          // 0: Off
    if (mode < 1.5) return IGN(I);       // 1: Smooth
    return quickNoise(I);                // 2: Grain
}

// === POST-PROCESS ===
vec3 softGamutMap(vec3 linearRgb) {
    float maxC = max(linearRgb.r, max(linearRgb.g, linearRgb.b));
    float minC = min(linearRgb.r, min(linearRgb.g, linearRgb.b));

    if (minC >= 0.0 && maxC <= 1.0) return linearRgb;

    vec3 lab = linearToOklab(max(linearRgb, 0.0));
    float L = clamp(lab.x, 0.0, 1.0);
    float C = length(lab.yz);
    float h = atan(lab.z, lab.y);

    float maxChroma = 0.4 * (1.0 - pow(abs(2.0 * L - 1.0), 2.0));

    if (C > maxChroma * 0.7) {
        float knee = maxChroma * 0.7;
        C = knee + (maxChroma - knee) * tanh((C - knee) / (maxChroma - knee + 0.001));
    }

    return clamp(oklabToLinear(vec3(L, C * cos(h), C * sin(h))), 0.0, 1.0);
}

vec3 applyContrastSaturation(vec3 linearRgb, float contrast, float saturation) {
    vec3 lab = linearToOklab(linearRgb);
    float C = length(lab.yz);
    float h = atan(lab.z, lab.y);

    lab.x = clamp((lab.x - 0.5) * contrast + 0.5, 0.0, 1.0);
    C *= saturation;
    lab.y = C * cos(h);
    lab.z = C * sin(h);

    return oklabToLinear(lab);
}

// === MAIN ===
void main() {
    vec2 fragCoord = v_uv * u_resolution;
    vec2 r = u_resolution;
    vec2 p = (fragCoord * 2.0 - r) / r.y;

    int colorCount = u_colors_length;

    // Early out: no colors -> black
    if (colorCount < 1) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    float t = u_time * 0.3;

    // Map time onto a circle so animation seamlessly wraps.
    float looping = step(0.5, u_loop);
    float phase = TAU * u_time / max(u_loop, 0.01);
    float radius = u_loop * u_speed * 0.3 / TAU;
    float tA = sin(phase) * radius;
    float tB = (1.0 - cos(phase)) * radius;

    // Seed-based offsets
    vec3 seedOffset = seedRandom(u_seed);
    vec3 seedOffset2 = seedRandom(u_seed + 100.0);

    // Golden angle rotation
    float seedAngle = u_seed * GOLDEN_ANGLE;
    vec2 seedPhase = (seedOffset2.xy - 0.5) * TAU;

    // Seed-based rotation
    float cs = cos(seedAngle);
    float sn = sin(seedAngle);
    mat2 rot = mat2(cs, -sn, sn, cs);
    p = rot * p;

    // === MOUSE PUSH === (disabled: the template ships with the mouse off)
    vec2 pushField = vec2(0.0);
    p -= rot * pushField * 2.0;

    // Get dither value
    float dither = getDither(floor(fragCoord / u_pixelRatio), u_ditherMode);

    // === TURBULENCE ===
    float totalVal = 0.0;
    float totalWeight = 0.0;
    int turbIter = int(u_turbIter);

    float freq = 1.0 / max(u_turbFreq, 0.01);

    for (float i = 0.0; i < 4.0; i++) {
        float eph = i / 4.0;

        vec2 q = p * u_scale;
        float sq = eph * eph;

        if (u_jellify > 0.5) {
            q.yx *= mix(1.0, 0.5, 1.0 - exp(-sq));
        }

        float a = seedPhase.x;
        float d = seedPhase.y;

        for (int j = 2; j < 13; j++) {
            if (j >= turbIter) break;
            float fj = float(j);
            // When looping, use circular time. Otherwise original t.
            float t1 = mix(t * u_speed, tA, looping);
            float t2 = mix(t * u_speed, tB, looping);
            q += u_turbAmp * sin(q.yx / freq * fj + t1 + vec2(a, d) + seedOffset.xy * fj) / fj;
            a += cos(fj + d * 1.2 + q.x * 2.0 - t1 + seedOffset2.z + t2 * 0.3 * looping);
            d += sin(fj * q.y + a + seedOffset.z + t1 + seedOffset2.y + t2 * 0.3 * looping);
        }

        float v = 0.5 + 0.5 * sin(length(q.yx + vec2(a, d) * 0.2) * u_waveFreq + i * i + seedOffset.x);
        float weight = smoothstep(0.0, 0.5, eph) * smoothstep(1.0, 0.5, eph);
        totalVal += v * weight;
        totalWeight += weight;
    }

    float val = totalVal / totalWeight;
    val = clamp((val - 0.3) / 0.4, 0.0, 1.0);
    val = pow(val, exp(-u_distBias));
    val = clamp(val + (dither - 0.5) * u_dither, 0.0, 1.0);

    vec3 col = paletteN(val, colorCount);
    col *= u_exposure;
    col = applyContrastSaturation(col, u_contrast, u_saturation);
    col = softGamutMap(col);
    col = toSrgb(col);

    fragColor = vec4(col, 1.0);
}
`;

const PALETTE = ["#020202", "#020202", "#3c50a5", "#c0d5d0", "#ff4000", "#020202"];

/** Seconds into the animation used for the single frame drawn under reduced motion. */
const STATIC_FRAME_TIME = 3;
const MAX_PIXEL_RATIO = 2;

const NUMBER_UNIFORMS: Record<string, number> = {
  u_seed: 36,
  u_speed: 1,
  u_loop: 0,
  u_scale: 0.64,
  u_turbAmp: 0.32,
  u_turbFreq: 2,
  u_turbIter: 3,
  u_waveFreq: 2.6,
  u_distBias: 0,
  u_jellify: 0,
  u_ditherMode: 1,
  u_dither: 0.07,
  u_exposure: 1.1,
  u_contrast: 1.1,
  u_saturation: 1,
};

function hexToRgba(hex: string): [number, number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, 1];
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    if (import.meta.env.DEV) console.warn("LiquidGradient shader error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

interface GlResources {
  buffer: WebGLBuffer | null;
  program: WebGLProgram;
  vertex: WebGLShader;
  fragment: WebGLShader;
  resolutionLocation: WebGLUniformLocation | null;
  timeLocation: WebGLUniformLocation | null;
  pixelRatioLocation: WebGLUniformLocation | null;
}

function freeResources(gl: WebGL2RenderingContext, r: GlResources) {
  gl.deleteBuffer(r.buffer);
  gl.deleteProgram(r.program);
  gl.deleteShader(r.vertex);
  gl.deleteShader(r.fragment);
}

/** Compiles the program and uploads buffers + constant uniforms. Called again after a context restore. */
function buildResources(gl: WebGL2RenderingContext): GlResources | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // One oversized triangle covers the whole viewport.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  gl.useProgram(program);
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const colors = new Float32Array(8 * 4);
  PALETTE.forEach((hex, i) => colors.set(hexToRgba(hex), i * 4));
  gl.uniform4fv(gl.getUniformLocation(program, "u_colors"), colors);
  gl.uniform1i(gl.getUniformLocation(program, "u_colors_length"), PALETTE.length);
  for (const [name, value] of Object.entries(NUMBER_UNIFORMS)) {
    gl.uniform1f(gl.getUniformLocation(program, name), value);
  }
  return {
    buffer,
    program,
    vertex,
    fragment,
    resolutionLocation: gl.getUniformLocation(program, "u_resolution"),
    timeLocation: gl.getUniformLocation(program, "u_time"),
    pixelRatioLocation: gl.getUniformLocation(program, "u_pixelRatio"),
  };
}

/**
 * Context release is deferred one task: React StrictMode re-runs the effect on the
 * same canvas, and getContext() would hand back an already-lost context. A re-run
 * cancels the pending release; a real unmount lets it fire.
 */
const pendingRelease = new WeakMap<HTMLCanvasElement, ReturnType<typeof setTimeout>>();

/**
 * Starts the gradient on `canvas`. Returns a cleanup function, or null when WebGL2
 * is unavailable (happy-dom, old browsers) — the caller's plain background shows.
 *
 * `coveredBy` names an element that scrolls over this canvas (the hero is sticky,
 * so IntersectionObserver on the canvas alone would report it visible forever):
 * once that element's top edge reaches the viewport top, rendering pauses.
 */
function startGradient(canvas: HTMLCanvasElement, coveredBy?: string): (() => void) | null {
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const context = gl;
  clearTimeout(pendingRelease.get(canvas));
  pendingRelease.delete(canvas);

  let resources = buildResources(context);
  if (!resources) return null;

  const reducedMotion =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const startedAt = performance.now();
  let inView = typeof IntersectionObserver === "undefined";
  let uncovered = true;
  let lost = false;
  let frame = 0;
  let disposed = false;

  function isVisible() {
    return inView && uncovered;
  }

  function resize() {
    if (!resources) return;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.viewport(0, 0, width, height);
    context.uniform2f(resources.resolutionLocation, width, height);
    context.uniform1f(resources.pixelRatioLocation, ratio);
  }

  function render(time: number) {
    if (!resources) return;
    context.uniform1f(resources.timeLocation, time);
    context.drawArrays(context.TRIANGLES, 0, 3);
  }

  function tick() {
    frame = 0;
    if (disposed || lost || !isVisible() || document.hidden) return;
    render((performance.now() - startedAt) / 1000);
    frame = requestAnimationFrame(tick);
  }

  function schedule() {
    if (reducedMotion) {
      if (!disposed && !lost) render(STATIC_FRAME_TIME);
      return;
    }
    if (frame === 0 && isVisible() && !document.hidden && !lost && !disposed) {
      frame = requestAnimationFrame(tick);
    }
  }

  resize();
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
    resize();
    if (reducedMotion) schedule();
  });
  resizeObserver?.observe(canvas);

  const intersectionObserver =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          inView = entry?.isIntersecting ?? false;
          schedule();
        });
  intersectionObserver?.observe(canvas);

  function checkCovered() {
    if (!coveredBy) return;
    const cover = document.querySelector(coveredBy);
    const next = !cover || cover.getBoundingClientRect().top > 0;
    if (next === uncovered) return;
    uncovered = next;
    schedule();
  }
  if (coveredBy) {
    window.addEventListener("scroll", checkCovered, { passive: true });
    window.addEventListener("resize", checkCovered);
    checkCovered();
  }

  const onVisibility = () => schedule();
  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    // The old objects died with the context; drop the handles.
    resources = null;
  };
  const onRestored = () => {
    if (disposed) return;
    resources = buildResources(context);
    if (!resources) return;
    lost = false;
    resize();
    if (reducedMotion) render(STATIC_FRAME_TIME);
    else schedule();
  };
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  if (reducedMotion) render(STATIC_FRAME_TIME);
  else schedule();

  return () => {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    window.removeEventListener("scroll", checkCovered);
    window.removeEventListener("resize", checkCovered);
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
    if (resources) freeResources(context, resources);
    resources = null;
    pendingRelease.set(
      canvas,
      setTimeout(() => {
        pendingRelease.delete(canvas);
        context.getExtension("WEBGL_lose_context")?.loseContext();
      }, 0),
    );
  };
}

/** Decorative animated gradient. Fills its positioned parent; renders nothing visible without WebGL2. */
export function LiquidGradient({ className, coveredBy }: { className?: string; coveredBy?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return startGradient(canvas, coveredBy) ?? undefined;
  }, [coveredBy]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
