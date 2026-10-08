/**
 * Pure color math for design lint: CSS color parsing, alpha compositing,
 * WCAG 2.x contrast and OKLab distance. No DOM, no canvas (the canvas based
 * parsers in `htmlToDesign/colorParsing.ts` need a browser and cannot run in
 * a worker or a plain unit test).
 */

export interface Rgba {
  /** 0-255 */
  r: number;
  g: number;
  b: number;
  /** 0-1 */
  a: number;
}

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  lime: "#00ff00",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  aqua: "#00ffff",
  magenta: "#ff00ff",
  fuchsia: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  navy: "#000080",
  purple: "#800080",
  teal: "#008080",
  orange: "#ffa500",
  pink: "#ffc0cb",
  brown: "#a52a2a",
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function parseHex(hex: string): Rgba | null {
  const h = hex.slice(1);
  if (!/^[0-9a-f]+$/i.test(h)) return null;
  if (h.length === 3 || h.length === 4) {
    const [r, g, b, a] = [...h].map((c) => parseInt(c + c, 16));
    return { r, g, b, a: a === undefined ? 1 : a / 255 };
  }
  if (h.length === 6 || h.length === 8) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}

/** Split `fn(a, b c / d)` arguments on commas, spaces and the slash. */
function functionArgs(input: string): { name: string; args: string[] } | null {
  const m = /^([a-z]+)\(\s*(.*?)\s*\)$/i.exec(input);
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: m[2].split(/\s*[,/]\s*|\s+/).filter((s) => s.length > 0) };
}

function num(token: string | undefined, percentScale: number): number | null {
  if (token === undefined) return null;
  const t = token.trim().toLowerCase();
  if (t === "none") return 0;
  if (t.endsWith("%")) {
    const v = Number(t.slice(0, -1));
    return Number.isFinite(v) ? (v / 100) * percentScale : null;
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function hue(token: string | undefined): number | null {
  if (token === undefined) return null;
  const m = /^(-?[\d.]+)(deg|rad|turn|grad)?$/i.exec(token.trim());
  if (!m) return null;
  const v = Number(m[1]);
  const unit = (m[2] ?? "deg").toLowerCase();
  const deg = unit === "rad" ? (v * 180) / Math.PI : unit === "turn" ? v * 360 : unit === "grad" ? v * 0.9 : v;
  return ((deg % 360) + 360) % 360;
}

function alphaOf(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const v = num(token, 1);
  return v === null ? null : clamp(v, 0, 1);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055;
  return clamp(c, 0, 1) * 255;
};

function oklabToRgb(L: number, A: number, B: number): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/**
 * Parse a CSS color: hex (3/4/6/8), rgb()/rgba(), hsl()/hsla(), oklch(), a
 * short list of named colors and `transparent`. Returns null for anything else
 * (`var()`, `currentColor`, gradients, unknown names) so callers can tell
 * "not a literal color" from a real value.
 */
export function parseColor(input: string | null | undefined): Rgba | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith("#")) return parseHex(s);
  if (NAMED[s]) return parseHex(NAMED[s]);
  const fn = functionArgs(s);
  if (!fn) return null;
  const { name, args } = fn;
  if (name === "rgb" || name === "rgba") {
    const [r, g, b] = [num(args[0], 255), num(args[1], 255), num(args[2], 255)];
    const a = alphaOf(args[3]);
    if (r === null || g === null || b === null || a === null || args.length < 3 || args.length > 4) return null;
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a };
  }
  if (name === "hsl" || name === "hsla") {
    const h = hue(args[0]);
    const sat = num(args[1], 1);
    const light = num(args[2], 1);
    const a = alphaOf(args[3]);
    if (h === null || sat === null || light === null || a === null || args.length < 3 || args.length > 4) return null;
    const [r, g, b] = hslToRgb(h, clamp(sat, 0, 1), clamp(light, 0, 1));
    return { r, g, b, a };
  }
  if (name === "oklch") {
    const L = num(args[0], 1);
    const C = num(args[1], 0.4);
    const h = hue(args[2]);
    const a = alphaOf(args[3]);
    if (L === null || C === null || h === null || a === null || args.length < 3 || args.length > 4) return null;
    const rad = (h * Math.PI) / 180;
    const [r, g, b] = oklabToRgb(clamp(L, 0, 1), C * Math.cos(rad), C * Math.sin(rad));
    return { r, g, b, a };
  }
  return null;
}

const hex2 = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");

/** `#rrggbb`, or `#rrggbbaa` when not fully opaque. */
export function toHex(c: Rgba): string {
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return c.a < 0.999 ? base + hex2(c.a * 255) : base;
}

/** `fg` painted over `bg` (source-over). The result is opaque when `bg` is. */
export function compositeOver(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (f: number, b: number) => (f * fg.a + b * bg.a * (1 - fg.a)) / a;
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a };
}

/** Scale the alpha of `c` by `factor` (0-1). */
export function withAlphaFactor(c: Rgba, factor: number): Rgba {
  return factor >= 1 ? c : { ...c, a: c.a * clamp(factor, 0, 1) };
}

/** WCAG 2.x relative luminance of the RGB part (alpha is ignored). */
export function relativeLuminance(c: Rgba): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** WCAG contrast ratio, 1..21. Both colors must already be opaque (composite first). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** WCAG "large text": at least 24px, or at least 18.66px (14pt) and bold. */
export function isLargeText(fontSizePx: number, fontWeight?: string | number): boolean {
  if (fontSizePx >= 24) return true;
  const w = typeof fontWeight === "number" ? fontWeight : Number(fontWeight);
  const bold = fontWeight === "bold" || fontWeight === "bolder" || (Number.isFinite(w) && w >= 700);
  return bold && fontSizePx >= 18.66;
}

/** Minimum contrast ratio for a text size at WCAG level AA (default) or AAA. */
export function requiredRatio(large: boolean, level: "AA" | "AAA" = "AA"): number {
  if (level === "AAA") return large ? 4.5 : 7;
  return large ? 3 : 4.5;
}

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

export function toOklab(c: Rgba): Oklab {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Euclidean distance in OKLab; about 0.02 is a just-noticeable difference. */
export function oklabDistance(x: Rgba, y: Rgba): number {
  const p = toOklab(x);
  const q = toOklab(y);
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

/** Same color within one 8-bit step per channel and 1% alpha. */
export function colorsEqual(x: Rgba, y: Rgba): boolean {
  return (
    Math.abs(x.r - y.r) < 1 && Math.abs(x.g - y.g) < 1 && Math.abs(x.b - y.b) < 1 && Math.abs(x.a - y.a) < 0.01
  );
}

/** Two decimals, but never rounded up to a threshold the ratio fails. */
export function formatRatio(ratio: number, need: number): string {
  const rounded = ratio.toFixed(2);
  return Number(rounded) >= need ? (Math.floor(ratio * 1000) / 1000).toString() : rounded;
}
