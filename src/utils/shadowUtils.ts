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
