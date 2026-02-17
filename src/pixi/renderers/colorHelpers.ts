import type { FlatSceneNode } from "@/types/scene";
import type { ThemeName } from "@/types/variable";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { resolveColor, applyOpacity } from "@/utils/colorUtils";

/**
 * Render-time theme context stack.
 * Frames with `themeOverride` push their override before rendering children
 * and pop it afterwards, matching the Konva renderer's behaviour.
 */
const themeStack: ThemeName[] = [];

export function pushRenderTheme(theme: ThemeName): void {
  themeStack.push(theme);
}

export function popRenderTheme(): void {
  themeStack.pop();
}

function getEffectiveTheme(): ThemeName {
  return themeStack.length > 0
    ? themeStack[themeStack.length - 1]
    : useThemeStore.getState().activeTheme;
}

export function getResolvedFill(node: FlatSceneNode): string | undefined {
  const variables = useVariableStore.getState().variables;
  const theme = getEffectiveTheme();
  const raw = resolveColor(node.fill, node.fillBinding, variables, theme);
  return raw ? applyOpacity(raw, node.fillOpacity) : raw;
}

export function getResolvedStroke(node: FlatSceneNode): string | undefined {
  const variables = useVariableStore.getState().variables;
  const theme = getEffectiveTheme();
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
      const rgb = (r << 16) | (g << 8) | b;
      return Number.isNaN(rgb) ? 0x000000 : rgb;
    }
  }
  // Handle hex
  const hex = color.replace("#", "");
  if (hex.length === 3) {
    const parsed = parseInt(hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2], 16);
    return Number.isNaN(parsed) ? 0x000000 : parsed;
  }
  // For 8-char hex (#RRGGBBAA), strip the alpha
  const parsed = parseInt(hex.slice(0, 6), 16);
  return Number.isNaN(parsed) ? 0x000000 : parsed;
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
