import type {
  ColorBinding,
  Effect,
  FlatSceneNode,
  GradientFill,
  ImageFill,
  LineCapShape,
  Paint,
  PathStroke,
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
  strokes?: Paint[];
  // Effects
  effect?: ShadowEffect;
  effects?: Effect[];
  // Appearance
  opacity?: number;

  // Corner radius (frame / rect only)
  cornerRadius?: number;
  cornerRadiusPerCorner?: PerCornerRadius;
  cornerSmoothing?: number;

  // Pen-drawn stroke (path only)
  pathStroke?: PathStroke;

  // Line cap shapes (line only)
  startCap?: LineCapShape;
  endCap?: LineCapShape;

  // Donut hole / star inner-radius ratio (ellipse arc / polygon-star only) —
  // style-like (visual proportion), unlike `sides`/`points` which are
  // excluded as geometry.
  innerRadiusRatio?: number;

  // Ellipse arc angles (ellipse only)
  startAngle?: number;
  sweepAngle?: number;

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
  "strokes",
  "effect",
  "effects",
  "opacity",
] as const satisfies readonly (keyof NodeStyleSnapshot)[];

const CORNER_RADIUS_KEYS = [
  "cornerRadius",
  "cornerRadiusPerCorner",
  "cornerSmoothing",
] as const satisfies readonly (keyof NodeStyleSnapshot)[];

const PATH_STYLE_KEYS = ["pathStroke"] as const satisfies readonly (keyof NodeStyleSnapshot)[];

const LINE_STYLE_KEYS = ["startCap", "endCap"] as const satisfies readonly (keyof NodeStyleSnapshot)[];

const ELLIPSE_ARC_KEYS = [
  "startAngle",
  "sweepAngle",
] as const satisfies readonly (keyof NodeStyleSnapshot)[];

const INNER_RADIUS_RATIO_KEYS = [
  "innerRadiusRatio",
] as const satisfies readonly (keyof NodeStyleSnapshot)[];

/**
 * `resolveRefToTree` (`@/utils/instanceRuntime`) only ever forwards these
 * fields from a `ref` (component instance) node onto the resolved render
 * tree — everything else in `NodeStyleSnapshot` (fills/effects stacks,
 * opacity, corner radius, ...) has nowhere to render for a `ref` target, so
 * writing it would mutate data and create an undo entry that silently does
 * nothing visually. Keep this in sync with the fields `resolveRefToTree`
 * actually reads off `refNode`.
 */
const REF_HONORED_KEYS = [
  "fill",
  "stroke",
  "strokeWidth",
  "fillBinding",
  "strokeBinding",
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

/** `innerRadiusRatio` is style-like on both the ellipse donut hole and the polygon star ratio. */
const INNER_RADIUS_RATIO_NODE_TYPES = new Set<FlatSceneNode["type"]>(["ellipse", "polygon"]);

/**
 * Dual-representation property groups (legacy single-value fields vs the
 * modern stacks — see the contract at the top of `@/utils/fillUtils`):
 * `fills` supersedes `fill`/`gradientFill`/`imageFill`/`fillOpacity`/
 * `fillBinding` when set, `strokes` supersedes `stroke`/`strokeOpacity`/
 * `strokeBinding` when set, and `effects` supersedes `effect`. A paste that
 * writes one representation must explicitly clear the counterpart on the
 * target (write `undefined` — the same pattern as `clearLegacyFillProps` /
 * `clearLegacyEffectProps` used by the fill/effects panels), otherwise a
 * target carrying the higher-priority representation would silently keep its
 * old look.
 */
const DUAL_REPRESENTATION_GROUPS: readonly (readonly string[])[] = [
  ["fills", "fill", "fillOpacity", "fillBinding", "gradientFill", "imageFill"],
  ["strokes", "stroke", "strokeOpacity", "strokeBinding"],
  ["effects", "effect"],
];

/**
 * For each dual-representation group where the style carries *any* data,
 * write every key of the group into `updates` — the source's value where it
 * has one, explicit `undefined` for the rest — so the pasted style fully
 * replaces the target's fill/effect state regardless of which representation
 * either side uses. Groups the style says nothing about are left untouched.
 */
function normalizeDualRepresentations(
  updates: Record<string, unknown>,
  styleSource: Record<string, unknown>,
): void {
  for (const group of DUAL_REPRESENTATION_GROUPS) {
    if (!group.some((key) => styleSource[key] !== undefined)) continue;
    for (const key of group) {
      updates[key] = styleSource[key];
    }
  }
}

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
 * Deep-clone every own value of `obj` (structuredClone) so the returned
 * object shares no array/object references with the source. Used when
 * building the clipboard snapshot so the clipboard, the source node, and any
 * future paste target never alias the same `fills`/`effects`/etc. arrays.
 */
function deepCloneOwnProperties<T extends object>(obj: T): T {
  const result = {} as T;
  for (const key of Object.keys(obj) as (keyof T)[]) {
    const value = obj[key];
    result[key] = (value !== null && typeof value === "object" ? structuredClone(value) : value) as T[keyof T];
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

  if (node.type === "path") {
    style = { ...style, ...pickDefined(source, PATH_STYLE_KEYS as readonly string[]) };
  }

  if (node.type === "line") {
    style = { ...style, ...pickDefined(source, LINE_STYLE_KEYS as readonly string[]) };
  }

  if (node.type === "ellipse") {
    style = { ...style, ...pickDefined(source, ELLIPSE_ARC_KEYS as readonly string[]) };
  }

  if (INNER_RADIUS_RATIO_NODE_TYPES.has(node.type)) {
    style = { ...style, ...pickDefined(source, INNER_RADIUS_RATIO_KEYS as readonly string[]) };
  }

  // The clipboard must own its data: deep-clone array/object fields (fills,
  // effects, cornerRadiusPerCorner, pathStroke, ...) so mutating the source
  // node (or a later paste target) after copying can never reach back into
  // this snapshot.
  return deepCloneOwnProperties(style);
}

/**
 * Given a copied style snapshot, compute the subset of properties that are
 * compatible with `target`'s node type — e.g. text typography is dropped
 * when pasting onto a rectangle, corner radius is dropped for anything but
 * frame/rect. Only properties actually present in `style` are included, so
 * applying the result never clobbers the target with `undefined` — with one
 * deliberate exception: for the dual-representation fill/effect groups, when
 * the style carries any data the counterpart representation is explicitly
 * written as `undefined` so the target's stale `fills`/`effects` (or legacy
 * fields) can't override the pasted style.
 */
export function pickStyleUpdatesForNode(
  target: FlatSceneNode,
  style: NodeStyleSnapshot,
): Partial<SceneNode> {
  const styleSource = style as unknown as Record<string, unknown>;

  // Component instances (`ref` nodes) resolve to their render tree via
  // `resolveRefToTree`, which only forwards a handful of fields from the ref
  // node itself (see `REF_HONORED_KEYS`). Every other style key is dead data
  // on a `ref` — restrict the paste to what actually renders instead of
  // silently no-op'ing.
  if (target.type === "ref") {
    return pickDefined(styleSource, REF_HONORED_KEYS as readonly string[]) as Partial<SceneNode>;
  }

  const updatesBase: Record<string, unknown> = pickDefined(styleSource, COMMON_STYLE_KEYS as readonly string[]);
  normalizeDualRepresentations(updatesBase, styleSource);
  let updates = updatesBase;

  if (CORNER_RADIUS_NODE_TYPES.has(target.type)) {
    updates = { ...updates, ...pickDefined(styleSource, CORNER_RADIUS_KEYS as readonly string[]) };
  }

  if (target.type === "text") {
    updates = { ...updates, ...pickDefined(styleSource, TEXT_STYLE_KEYS as readonly string[]) };
  }

  if (target.type === "path") {
    updates = { ...updates, ...pickDefined(styleSource, PATH_STYLE_KEYS as readonly string[]) };
  }

  if (target.type === "line") {
    updates = { ...updates, ...pickDefined(styleSource, LINE_STYLE_KEYS as readonly string[]) };
  }

  if (target.type === "ellipse") {
    updates = { ...updates, ...pickDefined(styleSource, ELLIPSE_ARC_KEYS as readonly string[]) };
  }

  if (INNER_RADIUS_RATIO_NODE_TYPES.has(target.type)) {
    updates = { ...updates, ...pickDefined(styleSource, INNER_RADIUS_RATIO_KEYS as readonly string[]) };
  }

  return updates as Partial<SceneNode>;
}
