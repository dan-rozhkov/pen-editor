import type { Effect, FlatSceneNode, Paint, ShadowEffect, SolidPaint } from "@/types/scene";
import { THEME_COLLECTION_ID, type ModeContext, type ThemeName } from "@/types/variable";
import { mergeModeContext, type ModeOverrides } from "@/lib/variables/modeContext";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { useStyleStore } from "@/store/styleStore";
import { resolveColor, applyOpacity } from "@/utils/colorUtils";
import {
  getResolvedRenderableFills as getResolvedRenderableFillsPure,
  getResolvedRenderableStrokes as getResolvedRenderableStrokesPure,
  resolveEffectStack,
} from "@/utils/fillUtils";

/**
 * Render-time mode context stack.
 * Frames whose mode overrides are non-empty push the merged context before
 * rendering children and pop it afterwards. Each entry is the already-merged
 * context, so the top of the stack is the effective one. With an empty stack
 * the document-level `themeStore.modeContext` applies (never a hard-coded
 * "light": a dark document recolors bound nodes without any frame override).
 */
const modeStack: ModeContext[] = [];

/** Push `current + overrides` (inner wins). Pair with {@link popRenderModes}. */
export function pushRenderModes(overrides: ModeOverrides): void {
  modeStack.push(mergeModeContext(getEffectiveModeContext(), overrides));
}

export function popRenderModes(): void {
  modeStack.pop();
}

/** Shim: a bare theme name is a pick for the Theme collection. */
export function pushRenderTheme(theme: ThemeName): void {
  pushRenderModes({ [THEME_COLLECTION_ID]: theme });
}

export const popRenderTheme = popRenderModes;

export function resetRenderThemeStack(): void {
  modeStack.length = 0;
}

export function getRenderThemeStackDepth(): number {
  return modeStack.length;
}

export function getEffectiveModeContext(): ModeContext {
  return modeStack.length > 0
    ? modeStack[modeStack.length - 1]
    : useThemeStore.getState().modeContext;
}

export function getResolvedFill(node: FlatSceneNode): string | undefined {
  const { variables, collections } = useVariableStore.getState();
  const theme = getEffectiveModeContext();
  const raw = resolveColor(node.fill, node.fillBinding, variables, theme, collections);
  return raw ? applyOpacity(raw, node.fillOpacity) : raw;
}

/**
 * Resolve an arbitrary {@link SolidPaint}'s color the same way `getResolvedFill`
 * resolves a node's `fill`: apply its `colorBinding` against the active theme,
 * then fold in the paint's per-layer `opacity`. Generalizes `getResolvedFill`
 * for the multi-fill paint stack.
 */
export function getResolvedSolidPaint(paint: SolidPaint): string | undefined {
  const { variables, collections } = useVariableStore.getState();
  const theme = getEffectiveModeContext();
  const raw = resolveColor(paint.color, paint.colorBinding, variables, theme, collections);
  return raw ? applyOpacity(raw, paint.opacity) : raw;
}

/**
 * Node's renderable fill stack with any fill-style (`styleId`) references
 * substituted in from `styleStore`, mirroring `getResolvedFill`'s variable
 * resolution. Because `resolveFillStylePaint` returns an ordinary `Paint`
 * (with the style's own `colorBinding`, if any, carried through), the
 * existing `getResolvedSolidPaint` call downstream resolves the
 * style → variable → theme chain with no extra code.
 */
export function getResolvedRenderableFills(node: FlatSceneNode): Paint[] {
  const { fillStyles } = useStyleStore.getState();
  return getResolvedRenderableFillsPure(node, fillStyles);
}

/**
 * Node's effective effect stack (style-resolved via `effectStyleId`, see
 * `resolveEffectStack`), with each shadow's `colorBinding` resolved against
 * the active theme's variables — completing the style → variable → theme
 * chain for shadow colors the same way `getResolvedFill` does for fills.
 */
export function getResolvedRenderableEffects(node: FlatSceneNode): Effect[] {
  const { effectStyles } = useStyleStore.getState();
  const { variables, collections } = useVariableStore.getState();
  const theme = getEffectiveModeContext();
  return resolveEffectStack(node, effectStyles).map((effect) => {
    if (effect.type !== "shadow" || !(effect as ShadowEffect).colorBinding) return effect;
    const shadow = effect as ShadowEffect;
    const resolved = resolveColor(shadow.color, shadow.colorBinding, variables, theme, collections);
    return resolved ? { ...shadow, color: resolved } : shadow;
  });
}

export function getResolvedStroke(node: FlatSceneNode): string | undefined {
  const { variables, collections } = useVariableStore.getState();
  const theme = getEffectiveModeContext();
  const raw = resolveColor(node.stroke, node.strokeBinding, variables, theme, collections);
  return raw ? applyOpacity(raw, node.strokeOpacity) : raw;
}

/**
 * Node's renderable stroke paint stack (see `BaseNode.strokes`), with any
 * stroke-style (`styleId`) references substituted in from `styleStore`,
 * mirroring `getResolvedRenderableFills`.
 */
export function getResolvedRenderableStrokes(node: FlatSceneNode): Paint[] {
  const { fillStyles } = useStyleStore.getState();
  return getResolvedRenderableStrokesPure(node, fillStyles);
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
