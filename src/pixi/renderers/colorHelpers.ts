import type { FlatSceneNode } from "@/types/scene";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { resolveColor, applyOpacity } from "@/utils/colorUtils";

export function getResolvedFill(node: FlatSceneNode): string | undefined {
  const variables = useVariableStore.getState().variables;
  const theme = useThemeStore.getState().activeTheme;
  const raw = resolveColor(node.fill, node.fillBinding, variables, theme);
  return raw ? applyOpacity(raw, node.fillOpacity) : raw;
}

export function getResolvedStroke(node: FlatSceneNode): string | undefined {
  const variables = useVariableStore.getState().variables;
  const theme = useThemeStore.getState().activeTheme;
  const raw = resolveColor(node.stroke, node.strokeBinding, variables, theme);
  return raw ? applyOpacity(raw, node.strokeOpacity) : raw;
}

export function parseColor(color: string): number {
  // Handle rgba/rgb formats
  if (color.startsWith("rgba(") || color.startsWith("rgb(")) {
    const m = color.match(/[\d.]+/g);
    if (m && m.length >= 3) {
      const r = parseInt(m[0]);
      const g = parseInt(m[1]);
      const b = parseInt(m[2]);
      return (r << 16) | (g << 8) | b;
    }
  }
  // Handle hex
  const hex = color.replace("#", "");
  if (hex.length === 3) {
    return parseInt(hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2], 16);
  }
  // For 8-char hex (#RRGGBBAA), strip the alpha
  return parseInt(hex.slice(0, 6), 16);
}

export function parseAlpha(color: string): number {
  if (color.startsWith("rgba(")) {
    const m = color.match(/[\d.]+/g);
    if (m && m.length >= 4) {
      return parseFloat(m[3]);
    }
  }
  if (color.startsWith("#") && color.length === 9) {
    return parseInt(color.slice(7, 9), 16) / 255;
  }
  return 1;
}

export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
