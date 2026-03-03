/** Extract url() value from a CSS property string */
export function extractCssUrl(value: string): string | null {
  const match = value.match(/url\(["']?(.*?)["']?\)/);
  return match?.[1] ?? null;
}

export interface ParsedColor {
  color: string;
  opacity?: number;
}

let colorParserCtx: CanvasRenderingContext2D | null = null;

/** Check if a CSS color is fully transparent */
export function isTransparentColor(color: string | null | undefined): boolean {
  if (!color) return true;
  const normalized = color.trim().toLowerCase();
  if (
    normalized === "transparent" ||
    normalized === "rgba(0, 0, 0, 0)" ||
    normalized === "rgba(0,0,0,0)"
  ) {
    return true;
  }

  const rgbaMatch = normalized.match(/^rgba\(([^)]+)\)$/);
  if (rgbaMatch?.[1]) {
    const parts = rgbaMatch[1].split(",").map((part) => part.trim());
    const alpha = Number(parts[3]);
    if (Number.isFinite(alpha) && alpha <= 0) return true;
  }

  const hslaMatch = normalized.match(/^hsla\(([^)]+)\)$/);
  if (hslaMatch?.[1]) {
    const parts = hslaMatch[1].split(",").map((part) => part.trim());
    const alpha = Number(parts[3]);
    if (Number.isFinite(alpha) && alpha <= 0) return true;
  }

  return false;
}

/** Parse CSS color into hex + optional opacity */
export function parseColorWithOpacity(cssColor: string): ParsedColor | null {
  if (isTransparentColor(cssColor)) return null;
  const input = cssColor.trim();

  const rgb = input.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (rgb) {
    const r = Math.round(parseFloat(rgb[1]));
    const g = Math.round(parseFloat(rgb[2]));
    const b = Math.round(parseFloat(rgb[3]));
    const alpha = rgb[4] !== undefined ? parseFloat(rgb[4]) : 1;
    const color = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    const normalizedAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    return normalizedAlpha < 1 ? { color, opacity: normalizedAlpha } : { color };
  }

  try {
    if (!colorParserCtx) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      colorParserCtx = canvas.getContext("2d");
    }
    if (colorParserCtx) {
      colorParserCtx.fillStyle = "#000000";
      colorParserCtx.fillStyle = input;
      colorParserCtx.clearRect(0, 0, 1, 1);
      colorParserCtx.fillRect(0, 0, 1, 1);
      const rgba = colorParserCtx.getImageData(0, 0, 1, 1).data;
      const r = rgba[0] ?? 0;
      const g = rgba[1] ?? 0;
      const b = rgba[2] ?? 0;
      const a = (rgba[3] ?? 255) / 255;
      const color = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      return a < 1 ? { color, opacity: a } : { color };
    }
  } catch {
    // fall through
  }

  return { color: cssColorToHex(input) };
}

/** Convert a CSS color string to hex */
export function cssColorToHex(color: string): string {
  // If already hex, return as-is
  if (color.startsWith("#")) return color;

  // Fast path: rgb/rgba can be parsed directly without canvas overhead
  const rgbMatch = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (rgbMatch) {
    const r = Math.round(parseFloat(rgbMatch[1]));
    const g = Math.round(parseFloat(rgbMatch[2]));
    const b = Math.round(parseFloat(rgbMatch[3]));
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  // Normalize modern CSS syntaxes (oklch/lab/etc) using browser color parser.
  try {
    if (!colorParserCtx) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      colorParserCtx = canvas.getContext("2d");
    }
    if (colorParserCtx) {
      colorParserCtx.fillStyle = "#000000";
      colorParserCtx.fillStyle = color;
      colorParserCtx.clearRect(0, 0, 1, 1);
      colorParserCtx.fillRect(0, 0, 1, 1);
      const rgba = colorParserCtx.getImageData(0, 0, 1, 1).data;
      if (rgba && rgba.length >= 3) {
        const r = rgba[0] ?? 0;
        const g = rgba[1] ?? 0;
        const b = rgba[2] ?? 0;
        return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      }
    }
  } catch {
    // keep original color and continue with regex parsing fallback
  }

  // Fallback for browsers that keep authored syntax (e.g. oklch()) in fillStyle:
  // resolve through computed style to canonical rgb/rgba.
  if (!/^rgba?\(/i.test(color)) {
    try {
      const probe = document.createElement("span");
      probe.style.color = color;
      probe.style.position = "fixed";
      probe.style.left = "-99999px";
      probe.style.top = "-99999px";
      document.body.appendChild(probe);
      const resolved = window.getComputedStyle(probe).color;
      document.body.removeChild(probe);
      if (resolved) color = resolved;
    } catch {
      // ignore and try regex parsing
    }
  }

  // Parse rgb/rgba
  const match = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (match) {
    const r = Math.round(parseFloat(match[1]));
    const g = Math.round(parseFloat(match[2]));
    const b = Math.round(parseFloat(match[3]));
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  return color;
}
