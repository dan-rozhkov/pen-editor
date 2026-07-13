/** Pure XML/unit helpers for the PPTX exporter. 1px = 9525 EMU (96dpi), 1px = 0.75pt. */

export const EMU_PER_PX = 9525;

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function pxToEmu(px: number): number {
  return Math.round(px * EMU_PER_PX);
}

/** Font/spacing sizes: DrawingML wants hundredths of a point. */
export function pxToPt100(px: number): number {
  return Math.round(px * 0.75 * 100);
}

/** Angles: DrawingML wants 60000ths of a degree in [0, 21600000). */
export function degTo60k(deg: number): number {
  const normalized = ((deg % 360) + 360) % 360;
  return Math.round(normalized * 60000);
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function parseHexColor(hex: string): { rgb: string; alpha: number } {
  if (!HEX_RE.test(hex)) return { rgb: "000000", alpha: 1 };
  let h = hex.slice(1);
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const rgb = h.slice(0, 6).toUpperCase();
  const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { rgb, alpha };
}

export function alphaToXml(alpha: number): string {
  if (alpha >= 1) return "";
  return `<a:alpha val="${Math.round(Math.max(0, alpha) * 100000)}"/>`;
}
