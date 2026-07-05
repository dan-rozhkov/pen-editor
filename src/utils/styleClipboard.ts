import type {
  ColorBinding,
  Effect,
  FlatSceneNode,
  GradientFill,
  ImageFill,
  Paint,
  PerCornerRadius,
  PerSideStroke,
  SceneNode,
  ShadowEffect,
  TextAlign,
  TextAlignVertical,
  TextTransform,
} from "@/types/scene";

/**
 * Figma-style "copy/paste properties": a serializable snapshot of a node's
 * *appearance* (fills, strokes, effects, corner radius, opacity, and text
 * typography) — deliberately excludes geometry (x/y/width/height), layout,
 * and identity fields so it can be pasted onto any other node.
 *
 * Split into three groups so `pickStyleUpdatesForNode` can gate each group by
 * target-node compatibility:
 *  - common: valid on every node type (`BaseNode`).
 *  - corner radius: only meaningful on `frame` / `rect`.
 *  - text: only meaningful on `text`.
 */
export interface NodeStyleSnapshot {
  // Fill
  fill?: string;
  fillOpacity?: number;
  fillBinding?: ColorBinding;
  imageFill?: ImageFill;
  gradientFill?: GradientFill;
  fills?: Paint[];
  // Stroke
  stroke?: string;
  strokeWidth?: number;
  strokeAlign?: "center" | "inside" | "outside";
  strokeWidthPerSide?: PerSideStroke;
  strokeOpacity?: number;
  strokeBinding?: ColorBinding;
  // Effects
  effect?: ShadowEffect;
  effects?: Effect[];
  // Appearance
  opacity?: number;

  // Corner radius (frame / rect only)
  cornerRadius?: number;
  cornerRadiusPerCorner?: PerCornerRadius;

  // Typography (text only)
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  underline?: boolean;
  strikethrough?: boolean;
  textAlign?: TextAlign;
  textAlignVertical?: TextAlignVertical;
  lineHeight?: number;
  letterSpacing?: number;
  textTransform?: TextTransform;
  truncateText?: boolean;
  maxLines?: number;
}

const COMMON_STYLE_KEYS = [
  "fill",
  "fillOpacity",
  "fillBinding",
  "imageFill",
  "gradientFill",
  "fills",
  "stroke",
  "strokeWidth",
  "strokeAlign",
  "strokeWidthPerSide",
  "strokeOpacity",
  "strokeBinding",
  "effect",
  "effects",
  "opacity",
] as const satisfies readonly (keyof NodeStyleSnapshot)[];

const CORNER_RADIUS_KEYS = [
  "cornerRadius",
  "cornerRadiusPerCorner",
] as const satisfies readonly (keyof NodeStyleSnapshot)[];

const TEXT_STYLE_KEYS = [
  "fontSize",
  "fontFamily",
  "fontWeight",
  "fontStyle",
  "underline",
  "strikethrough",
  "textAlign",
  "textAlignVertical",
  "lineHeight",
  "letterSpacing",
  "textTransform",
  "truncateText",
  "maxLines",
] as const satisfies readonly (keyof NodeStyleSnapshot)[];

const CORNER_RADIUS_NODE_TYPES = new Set<FlatSceneNode["type"]>(["frame", "rect"]);

function pickDefined<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Extract the copyable style snapshot from a node. Group-gated by the
 * *source* node's type: corner radius only comes from frame/rect, typography
 * only from text — so a rect never "leaks" phantom font properties into the
 * clipboard.
 */
export function extractNodeStyle(node: FlatSceneNode): NodeStyleSnapshot {
  const source = node as unknown as Record<string, unknown>;
  let style: NodeStyleSnapshot = pickDefined(source, COMMON_STYLE_KEYS as readonly string[]) as NodeStyleSnapshot;

  if (CORNER_RADIUS_NODE_TYPES.has(node.type)) {
    style = { ...style, ...pickDefined(source, CORNER_RADIUS_KEYS as readonly string[]) };
  }

  if (node.type === "text") {
    style = { ...style, ...pickDefined(source, TEXT_STYLE_KEYS as readonly string[]) };
  }

  return style;
}

/**
 * Given a copied style snapshot, compute the subset of properties that are
 * compatible with `target`'s node type — e.g. text typography is dropped
 * when pasting onto a rectangle, corner radius is dropped for anything but
 * frame/rect. Only properties actually present in `style` are included, so
 * applying the result never clobbers the target with `undefined`.
 */
export function pickStyleUpdatesForNode(
  target: FlatSceneNode,
  style: NodeStyleSnapshot,
): Partial<SceneNode> {
  const styleSource = style as unknown as Record<string, unknown>;
  let updates: Record<string, unknown> = pickDefined(styleSource, COMMON_STYLE_KEYS as readonly string[]);

  if (CORNER_RADIUS_NODE_TYPES.has(target.type)) {
    updates = { ...updates, ...pickDefined(styleSource, CORNER_RADIUS_KEYS as readonly string[]) };
  }

  if (target.type === "text") {
    updates = { ...updates, ...pickDefined(styleSource, TEXT_STYLE_KEYS as readonly string[]) };
  }

  return updates as Partial<SceneNode>;
}
