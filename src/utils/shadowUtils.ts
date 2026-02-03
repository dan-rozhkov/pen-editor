import type { ShadowEffect } from "@/types/scene";

/**
 * Parse hex color with optional alpha (e.g. '#00000040') into color and opacity.
 */
export function parseHexAlpha(hex: string): { color: string; opacity: number } {
  if (hex.length === 9) {
    // #RRGGBBAA
    const alpha = parseInt(hex.slice(7, 9), 16) / 255;
    return { color: hex.slice(0, 7), opacity: alpha };
  }
  if (hex.length === 5) {
    // #RGBA
    const alpha = parseInt(hex[4] + hex[4], 16) / 255;
    return { color: hex.slice(0, 4), opacity: alpha };
  }
  return { color: hex, opacity: 1 };
}

/**
 * Build Konva shadow props from a ShadowEffect.
 * Konva doesn't support 'spread' natively — we emulate by adding spread to blur.
 */
export function buildKonvaShadowProps(effect: ShadowEffect | undefined) {
  if (!effect) return {};

  const { color, opacity } = parseHexAlpha(effect.color);

  return {
    shadowColor: color,
    shadowBlur: effect.blur + effect.spread,
    shadowOffsetX: effect.offset.x,
    shadowOffsetY: effect.offset.y,
    shadowOpacity: opacity,
    shadowEnabled: true,
    shadowForStrokeEnabled: false,
  };
}

export function getDefaultShadow(): ShadowEffect {
  return {
    type: "shadow",
    shadowType: "outer",
    color: "#00000040",
    offset: { x: 0, y: 4 },
    blur: 8,
    spread: 0,
  };
}
