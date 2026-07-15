import {
  generateId,
  type SceneNode,
  type FrameNode,
  type GroupNode,
  type RectNode,
  type EllipseNode,
  type TextNode,
  type LineNode,
  type PolygonNode,
  type PathNode,
  type LayoutProperties,
  type SizingProperties,
  type GradientFill,
  type GradientColorStop,
  type PerSideStroke,
  type PerCornerRadius,
  type Paint,
  type SolidPaint,
  type GradientPaint,
  type ImagePaint,
  type Effect,
  type ShadowEffect,
  type BlurEffect,
  type BackgroundBlurEffect,
  type ImageFillMode,
  type PaintBlendMode,
  PAINT_BLEND_MODES,
} from "../types/scene";
import { generatePolygonPoints } from "./polygonUtils";
import { getPathBBox } from "./svgUtils";

// --- Pixso JSON types (Figma Plugin API field names) ---

interface PixsoColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface PixsoGradientStop {
  position: number;
  color: PixsoColor;
}

interface PixsoSolidPaint {
  type: "SOLID";
  color: PixsoColor;
  opacity?: number;
  visible?: boolean;
  blendMode?: string;
}

interface PixsoImagePaint {
  type: "IMAGE";
  imageHash?: string;
  imageRef?: string;
  scaleMode?: string;
  opacity?: number;
  visible?: boolean;
  blendMode?: string;
}

interface PixsoGradientPaint {
  type:
    | "GRADIENT_LINEAR"
    | "GRADIENT_RADIAL"
    | "GRADIENT_ANGULAR"
    | "GRADIENT_DIAMOND";
  gradientTransform?: number[][];
  gradientStops?: PixsoGradientStop[];
  opacity?: number;
  visible?: boolean;
  blendMode?: string;
}

type PixsoPaint = PixsoSolidPaint | PixsoImagePaint | PixsoGradientPaint;

interface PixsoFontName {
  family: string;
  style: string;
}

interface PixsoLineHeight {
  value: number;
  unit: "PIXELS" | "PERCENT" | "AUTO";
}

interface PixsoLetterSpacing {
  value: number;
  unit: "PIXELS" | "PERCENT";
}

interface PixsoGeometry {
  path: string;
  windingRule?: "NONZERO" | "EVENODD";
}

interface PixsoIndividualStrokeWeights {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface PixsoArcData {
  startingAngle: number;
  endingAngle: number;
  innerRadius: number;
}

interface PixsoEffect {
  type: "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR" | string;
  color?: PixsoColor;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
  visible?: boolean;
}

interface PixsoHyperlink {
  type?: "URL" | "NODE";
  value?: string;
  url?: string;
}

interface PixsoLayoutGrid {
  pattern?: "COLUMNS" | "ROWS" | "GRID" | string;
  visible?: boolean;
  color?: PixsoColor;
  sectionSize?: number;
  count?: number;
  gutterSize?: number;
  offset?: number;
  alignment?: "MIN" | "MAX" | "CENTER" | "STRETCH" | string;
}

interface PixsoNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  locked?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  blendMode?: string;

  // Shape + Container props
  fills?: PixsoPaint[];
  strokes?: PixsoPaint[];
  strokeWeight?: number;
  strokeAlign?: string;
  individualStrokeWeights?: PixsoIndividualStrokeWeights;
  strokeTopWeight?: number;
  strokeRightWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
  cornerRadius?: number;
  cornerSmoothing?: number;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomLeftRadius?: number;
  bottomRightRadius?: number;

  // Effects
  effects?: PixsoEffect[];

  // Container props
  children?: PixsoNode[];
  clipsContent?: boolean;
  layoutGrids?: PixsoLayoutGrid[];

  // Auto-layout props
  layoutMode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  layoutWrap?: string;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;

  // Child-in-auto-layout props
  layoutPositioning?: string;
  layoutGrow?: number;
  layoutAlign?: string;

  // Text props
  characters?: string;
  fontSize?: number;
  fontFamily?: string;
  fontName?: PixsoFontName | string;
  fontWeight?: number | string;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  lineHeight?: PixsoLineHeight | number;
  letterSpacing?: PixsoLetterSpacing | number;
  textCase?: string;
  textDecoration?: string;
  textAutoResize?: string;
  paragraphSpacing?: number;
  maxLines?: number;
  hyperlink?: PixsoHyperlink | null;

  // Ellipse arc
  arcData?: PixsoArcData;

  // Vector geometry (VECTOR / BOOLEAN_OPERATION nodes)
  fillGeometry?: PixsoGeometry[];
  strokeGeometry?: PixsoGeometry[];

  // STAR / POLYGON node props (Figma REST API field names)
  pointCount?: number;
  innerRadius?: number;

  // Component/instance props
  componentProperties?: Record<string, unknown>;
  componentId?: string;
  overrides?: unknown[];
  isMasterComponent?: boolean;
}

/** Extra context threaded through conversion (image bytes resolved by hash). */
export interface PixsoImportContext {
  imageMap?: Record<string, string>;
}

// --- Helpers ---

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function channel(v: number): string {
  return Math.round(clamp01(v) * 255)
    .toString(16)
    .padStart(2, "0");
}

function pixsoColorToHex(color: PixsoColor): string {
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

/** Hex including alpha channel when the color carries a < 1 alpha. */
function pixsoColorToHexA(color: PixsoColor): string {
  const rgb = pixsoColorToHex(color);
  if (color.a !== undefined && color.a < 1) {
    return `${rgb}${channel(color.a)}`;
  }
  return rgb;
}

function mapBlendMode(blendMode?: string): PaintBlendMode | undefined {
  if (!blendMode) return undefined;
  const normalized = blendMode.toLowerCase().replace(/_/g, "-");
  if (normalized === "normal" || normalized === "pass-through") return undefined;
  return (PAINT_BLEND_MODES as readonly string[]).includes(normalized)
    ? (normalized as PaintBlendMode)
    : undefined;
}

function mapScaleMode(scaleMode?: string): ImageFillMode {
  switch (scaleMode) {
    case "FIT":
      return "fit";
    case "STRETCH":
      return "stretch";
    case "CROP":
      // Figma CROP preserves aspect ratio and crops overflow (CSS `cover`) —
      // that is our "fill", not "stretch" (which distorts each axis).
      return "fill";
    case "FILL":
    case "TILE":
    default:
      return "fill";
  }
}

function visiblePaints(paints?: PixsoPaint[]): PixsoPaint[] {
  if (!paints) return [];
  return paints.filter((p) => p.visible !== false);
}

function pixsoGradientToFill(gradient: PixsoGradientPaint): GradientFill | undefined {
  if (!gradient.gradientStops?.length) return undefined;

  const stops: GradientColorStop[] = gradient.gradientStops.map((s) => ({
    color: pixsoColorToHex(s.color),
    position: clamp01(s.position),
    opacity: s.color.a !== undefined && s.color.a < 1 ? s.color.a : undefined,
  }));

  // Angular/diamond gradients have no direct scene equivalent — fall back to
  // radial (closest visual) rather than dropping the paint entirely.
  const isLinear = gradient.type === "GRADIENT_LINEAR";

  // gradientTransform is a 2x3 affine matrix [[a, c, e], [b, d, f]] mapping the
  // gradient's unit space into the node's normalized 0-1 box.
  let startX = isLinear ? 0 : 0.5;
  let startY = 0.5;
  let endX = 1;
  let endY = 0.5;

  if (gradient.gradientTransform && gradient.gradientTransform.length >= 2) {
    const [[a, , e], [b, , f]] = gradient.gradientTransform;
    startX = e;
    startY = f;
    endX = a + e;
    endY = b + f;
  }

  return {
    type: isLinear ? "linear" : "radial",
    stops,
    startX,
    startY,
    endX,
    endY,
  };
}

/**
 * Convert visible Pixso paints into a Figma-style `Paint[]` stack. Shared by
 * `buildFills` (fill) and `buildStrokes` (stroke) — image paints are only
 * meaningful as a fill; `buildStrokes` filters them back out (mirrors
 * `applyStrokePaints`'s IMAGE exclusion in the Figma-paste importer). Image
 * paints are resolved via `ctx.imageMap` (by hash) — an unresolved image
 * paint is dropped with a warning.
 */
function buildPaintStack(paints: PixsoPaint[] | undefined, ctx: PixsoImportContext): Paint[] {
  const visible = visiblePaints(paints);
  const stack: Paint[] = [];
  for (const paint of visible) {
    if (paint.type === "SOLID") {
      const solid: SolidPaint = {
        id: generateId(),
        type: "solid",
        color: pixsoColorToHexA(paint.color),
      };
      if (paint.opacity !== undefined && paint.opacity < 1) solid.opacity = paint.opacity;
      const bm = mapBlendMode(paint.blendMode);
      if (bm) solid.blendMode = bm;
      stack.push(solid);
    } else if (
      paint.type === "GRADIENT_LINEAR" ||
      paint.type === "GRADIENT_RADIAL" ||
      paint.type === "GRADIENT_ANGULAR" ||
      paint.type === "GRADIENT_DIAMOND"
    ) {
      const gradient = pixsoGradientToFill(paint);
      if (!gradient) continue;
      const gp: GradientPaint = { id: generateId(), type: "gradient", gradient };
      if (paint.opacity !== undefined && paint.opacity < 1) gp.opacity = paint.opacity;
      const bm = mapBlendMode(paint.blendMode);
      if (bm) gp.blendMode = bm;
      stack.push(gp);
    } else if (paint.type === "IMAGE") {
      const hash = paint.imageHash ?? paint.imageRef;
      const url = hash ? ctx.imageMap?.[hash] : undefined;
      if (!url) {
        console.warn(
          `[pixso-import] IMAGE paint (hash ${hash ?? "?"}) has no embedded bytes; skipping.`,
        );
        continue;
      }
      const ip: ImagePaint = {
        id: generateId(),
        type: "image",
        image: { url, mode: mapScaleMode(paint.scaleMode) },
      };
      if (paint.opacity !== undefined && paint.opacity < 1) ip.opacity = paint.opacity;
      const bm = mapBlendMode(paint.blendMode);
      if (bm) ip.blendMode = bm;
      stack.push(ip);
    }
  }
  return stack;
}

/**
 * Build a Figma-style Paint[] stack from Pixso fills. Returns:
 * - `{ fill, fillOpacity }` legacy fields when there is exactly one visible
 *   solid paint (keeps simple nodes clean and back-compatible), OR
 * - `{ fills }` when the stack has a gradient/image or more than one paint.
 */
function buildFills(
  paints: PixsoPaint[] | undefined,
  ctx: PixsoImportContext,
): {
  fill?: string;
  fillOpacity?: number;
  gradientFill?: GradientFill;
  fills?: Paint[];
} {
  const visible = visiblePaints(paints);
  if (visible.length === 0) return {};

  const stack = buildPaintStack(paints, ctx);
  if (stack.length === 0) return {};

  // Single plain solid → legacy fields (clean, back-compatible). Only collapse
  // when there is no blend mode to preserve (legacy `fill` can't carry one;
  // `fillOpacity` covers layer opacity).
  if (stack.length === 1 && stack[0].type === "solid") {
    const solid = stack[0] as SolidPaint;
    if (!solid.blendMode) {
      const result: { fill: string; fillOpacity?: number } = { fill: solid.color };
      if (solid.opacity !== undefined && solid.opacity < 1) result.fillOpacity = solid.opacity;
      return result;
    }
  }

  // Single gradient → legacy gradientFill (well-trodden renderer path). Only
  // collapse when there is no layer opacity or blend mode to preserve —
  // `gradientFill` can't carry either.
  if (stack.length === 1 && stack[0].type === "gradient") {
    const gp = stack[0] as GradientPaint;
    if (!gp.blendMode && (gp.opacity === undefined || gp.opacity >= 1)) {
      return { gradientFill: gp.gradient };
    }
  }

  return { fills: stack };
}

/** First visible solid color as a plain hex — used for text color / stroke. */
function firstSolidHex(paints?: PixsoPaint[]): { hex?: string; opacity?: number } {
  const solid = visiblePaints(paints).find((p) => p.type === "SOLID") as
    | PixsoSolidPaint
    | undefined;
  if (!solid) return {};
  const result: { hex: string; opacity?: number } = {
    hex: pixsoColorToHex(solid.color),
  };
  if (solid.opacity !== undefined && solid.opacity < 1) result.opacity = solid.opacity;
  return result;
}

/**
 * Build the editor's stroke representation from Pixso strokes, mirroring
 * `buildFills`/`applyStrokePaints` (Figma paste importer): a gradient or
 * multi-paint stroke becomes a `strokes` paint stack instead of being
 * silently dropped (the old behavior — `firstSolidHex` found no SOLID paint
 * for a gradient stroke and returned nothing at all). Image paints are
 * excluded (unsupported on a stroke), matching the Figma-paste convention.
 */
function extractStroke(
  strokes: PixsoPaint[] | undefined,
  strokeWeight: number | undefined,
  hasPerSide: boolean,
  ctx: PixsoImportContext,
): { stroke?: string; strokeWidth?: number; strokeOpacity?: number; strokes?: Paint[] } {
  if (!strokes || !strokes.length) return {};
  // A node can define its stroke width uniformly (`strokeWeight`) or per-side
  // (`individualStrokeWeights`); with only per-side widths `strokeWeight` is
  // absent, but the stroke color must still be imported.
  const hasWidth = (strokeWeight !== undefined && strokeWeight > 0) || hasPerSide;
  if (!hasWidth) return {};

  const stack = buildPaintStack(strokes, ctx).filter((p) => p.type !== "image");
  if (stack.length === 0) return {};

  const widthProps: { strokeWidth?: number } = {};
  if (strokeWeight !== undefined && strokeWeight > 0) widthProps.strokeWidth = strokeWeight;

  if (stack.length >= 2 || stack[0].type === "gradient") {
    return { strokes: stack, ...widthProps };
  }
  const solid = stack[0] as SolidPaint;
  const result: { stroke: string; strokeWidth?: number; strokeOpacity?: number } = {
    stroke: solid.color,
    ...widthProps,
  };
  if (solid.opacity !== undefined && solid.opacity < 1) result.strokeOpacity = solid.opacity;
  return result;
}

function mapStrokeAlign(align?: string): "center" | "inside" | "outside" | undefined {
  switch (align) {
    case "INSIDE":
      return "inside";
    case "OUTSIDE":
      return "outside";
    case "CENTER":
      return "center";
    default:
      return undefined;
  }
}

function extractPerSideStroke(node: PixsoNode): PerSideStroke | undefined {
  const fromObject = node.individualStrokeWeights;
  if (fromObject) {
    return {
      top: fromObject.top,
      right: fromObject.right,
      bottom: fromObject.bottom,
      left: fromObject.left,
    };
  }

  const top = node.strokeTopWeight;
  const right = node.strokeRightWeight;
  const bottom = node.strokeBottomWeight;
  const left = node.strokeLeftWeight;

  if (
    top === undefined &&
    right === undefined &&
    bottom === undefined &&
    left === undefined
  ) {
    return undefined;
  }

  return { top, right, bottom, left };
}

function extractCornerRadius(node: PixsoNode): {
  cornerRadius?: number;
  cornerRadiusPerCorner?: PerCornerRadius;
} {
  if (node.cornerRadius && node.cornerRadius > 0) return { cornerRadius: node.cornerRadius };
  const tl = node.topLeftRadius ?? 0;
  const tr = node.topRightRadius ?? 0;
  const bl = node.bottomLeftRadius ?? 0;
  const br = node.bottomRightRadius ?? 0;
  if (tl > 0 || tr > 0 || bl > 0 || br > 0) {
    if (tl === tr && tr === br && br === bl) {
      return { cornerRadius: tl };
    }
    return {
      cornerRadiusPerCorner: {
        topLeft: tl || undefined,
        topRight: tr || undefined,
        bottomLeft: bl || undefined,
        bottomRight: br || undefined,
      },
    };
  }
  return {};
}

function extractEffects(effects?: PixsoEffect[]): Effect[] | undefined {
  if (!effects || effects.length === 0) return undefined;
  const result: Effect[] = [];
  for (const e of effects) {
    switch (e.type) {
      case "DROP_SHADOW":
      case "INNER_SHADOW": {
        const shadow: ShadowEffect = {
          type: "shadow",
          shadowType: e.type === "INNER_SHADOW" ? "inner" : "outer",
          color: e.color ? pixsoColorToHexA(e.color) : "#00000040",
          offset: { x: e.offset?.x ?? 0, y: e.offset?.y ?? 0 },
          blur: e.radius ?? 0,
          spread: e.spread ?? 0,
          id: generateId(),
        };
        if (e.visible === false) shadow.visible = false;
        result.push(shadow);
        break;
      }
      case "LAYER_BLUR": {
        const blur: BlurEffect = { type: "blur", radius: e.radius ?? 0, id: generateId() };
        if (e.visible === false) blur.visible = false;
        result.push(blur);
        break;
      }
      case "BACKGROUND_BLUR": {
        const bg: BackgroundBlurEffect = {
          type: "background-blur",
          radius: e.radius ?? 0,
          id: generateId(),
        };
        if (e.visible === false) bg.visible = false;
        result.push(bg);
        break;
      }
      default:
        // Unknown effect kind (e.g. NOISE) — skip, don't fail.
        break;
    }
  }
  return result.length > 0 ? result : undefined;
}

function mapJustifyContent(value?: string): LayoutProperties["justifyContent"] {
  switch (value) {
    case "MIN":
      return "flex-start";
    case "CENTER":
      return "center";
    case "MAX":
      return "flex-end";
    case "SPACE_BETWEEN":
      return "space-between";
    default:
      return undefined;
  }
}

function mapAlignItems(value?: string): LayoutProperties["alignItems"] {
  switch (value) {
    case "MIN":
      return "flex-start";
    case "CENTER":
      return "center";
    case "MAX":
      return "flex-end";
    case "STRETCH":
    case "BASELINE":
      return "stretch";
    default:
      return undefined;
  }
}

function extractLayout(node: PixsoNode): {
  layout?: LayoutProperties;
  sizing?: SizingProperties;
} {
  if (!node.layoutMode || node.layoutMode === "NONE") {
    // A non-auto-layout node can still carry min/max clamps (rare) — ignore
    // those here; they only make sense inside an auto-layout parent.
    return {};
  }

  const isHorizontal = node.layoutMode === "HORIZONTAL";
  const layout: LayoutProperties = {
    autoLayout: true,
    flexDirection: isHorizontal ? "row" : "column",
    gap: node.itemSpacing ?? 0,
    paddingTop: node.paddingTop ?? 0,
    paddingRight: node.paddingRight ?? 0,
    paddingBottom: node.paddingBottom ?? 0,
    paddingLeft: node.paddingLeft ?? 0,
    justifyContent: mapJustifyContent(node.primaryAxisAlignItems),
    alignItems: mapAlignItems(node.counterAxisAlignItems),
  };
  if (node.layoutWrap === "WRAP") layout.flexWrap = true;

  const sizing: SizingProperties = {};
  if (node.primaryAxisSizingMode === "AUTO") {
    if (isHorizontal) sizing.widthMode = "fit_content";
    else sizing.heightMode = "fit_content";
  }
  if (node.counterAxisSizingMode === "AUTO") {
    if (isHorizontal) sizing.heightMode = "fit_content";
    else sizing.widthMode = "fit_content";
  }
  if (node.minWidth !== undefined) sizing.minWidth = node.minWidth;
  if (node.maxWidth !== undefined) sizing.maxWidth = node.maxWidth;
  if (node.minHeight !== undefined) sizing.minHeight = node.minHeight;
  if (node.maxHeight !== undefined) sizing.maxHeight = node.maxHeight;

  const hasSizing =
    sizing.widthMode ||
    sizing.heightMode ||
    sizing.minWidth !== undefined ||
    sizing.maxWidth !== undefined ||
    sizing.minHeight !== undefined ||
    sizing.maxHeight !== undefined;

  return { layout, sizing: hasSizing ? sizing : undefined };
}

/**
 * Sizing/positioning a child gets from its own props relative to the parent's
 * auto-layout axis. Only meaningful when `parentLayoutMode` is HORIZONTAL /
 * VERTICAL.
 */
function extractChildLayoutProps(
  node: PixsoNode,
  parentLayoutMode?: string,
): { absolutePosition?: boolean; sizing?: SizingProperties } {
  if (!parentLayoutMode || parentLayoutMode === "NONE") return {};

  if (node.layoutPositioning === "ABSOLUTE") {
    return { absolutePosition: true };
  }

  const isHorizontal = parentLayoutMode === "HORIZONTAL";
  const sizing: SizingProperties = {};
  // layoutGrow=1 → fill on the parent's primary axis.
  if (node.layoutGrow && node.layoutGrow > 0) {
    if (isHorizontal) sizing.widthMode = "fill_container";
    else sizing.heightMode = "fill_container";
  }
  // layoutAlign=STRETCH → fill on the parent's counter axis.
  if (node.layoutAlign === "STRETCH") {
    if (isHorizontal) sizing.heightMode = "fill_container";
    else sizing.widthMode = "fill_container";
  }
  return sizing.widthMode || sizing.heightMode ? { sizing } : {};
}

function mapLayoutGrids(grids?: PixsoLayoutGrid[]): FrameNode["layoutGrids"] | undefined {
  if (!grids || grids.length === 0) return undefined;
  const mapped = grids.map((g) => {
    const type =
      g.pattern === "COLUMNS" ? "columns" : g.pattern === "ROWS" ? "rows" : "grid";
    const alignment =
      g.alignment === "MAX"
        ? "max"
        : g.alignment === "CENTER"
          ? "center"
          : g.alignment === "MIN"
            ? "min"
            : "stretch";
    return {
      id: generateId(),
      type: type as "columns" | "rows" | "grid",
      visible: g.visible !== false,
      color: g.color ? pixsoColorToHex(g.color) : "#FF0000",
      opacity: g.color?.a ?? 0.1,
      size: g.sectionSize,
      count: g.count,
      gutter: g.gutterSize,
      margin: g.offset,
      alignment: alignment as "min" | "max" | "center" | "stretch",
    };
  });
  return mapped;
}

const FONT_WEIGHT_MAP: Record<string, string> = {
  thin: "100",
  hairline: "100",
  extralight: "200",
  ultralight: "200",
  light: "300",
  normal: "400",
  regular: "400",
  medium: "500",
  semibold: "600",
  demibold: "600",
  bold: "700",
  extrabold: "800",
  ultrabold: "800",
  black: "900",
  heavy: "900",
};

function fontWeightFromStyle(style: string): string | undefined {
  const s = style.toLowerCase().replace(/\s+/g, "");
  for (const [key, weight] of Object.entries(FONT_WEIGHT_MAP)) {
    if (s.includes(key)) return weight;
  }
  return undefined;
}

function mapTextCase(textCase?: string): TextNode["textTransform"] | undefined {
  switch (textCase) {
    case "UPPER":
      return "uppercase";
    case "LOWER":
      return "lowercase";
    case "TITLE":
      return "capitalize";
    case "ORIGINAL":
    default:
      return undefined;
  }
}

function mapTextAutoResize(value?: string): TextNode["textWidthMode"] | undefined {
  switch (value) {
    case "WIDTH_AND_HEIGHT":
      return "auto";
    case "HEIGHT":
      return "fixed";
    case "NONE":
    case "TRUNCATE":
      return "fixed-height";
    default:
      return undefined;
  }
}

function extractTextProps(node: PixsoNode): Partial<TextNode> {
  const props: Partial<TextNode> = {};

  props.text = node.characters ?? "";
  if (node.fontSize) props.fontSize = node.fontSize;

  // Font family + weight/style from fontName
  if (node.fontName) {
    if (typeof node.fontName === "string") {
      props.fontFamily = node.fontName;
    } else {
      props.fontFamily = node.fontName.family;
      const style = node.fontName.style ?? "";
      const weight = fontWeightFromStyle(style);
      if (weight) props.fontWeight = weight;
      if (style.toLowerCase().includes("italic")) props.fontStyle = "italic";
    }
  } else if (node.fontFamily) {
    props.fontFamily = node.fontFamily;
  }
  // Explicit numeric fontWeight wins over derived-from-style.
  if (node.fontWeight !== undefined) props.fontWeight = String(node.fontWeight);

  switch (node.textAlignHorizontal) {
    case "LEFT":
      props.textAlign = "left";
      break;
    case "CENTER":
      props.textAlign = "center";
      break;
    case "RIGHT":
    case "JUSTIFIED":
      props.textAlign = node.textAlignHorizontal === "JUSTIFIED" ? "left" : "right";
      break;
  }

  switch (node.textAlignVertical) {
    case "TOP":
      props.textAlignVertical = "top";
      break;
    case "CENTER":
      props.textAlignVertical = "middle";
      break;
    case "BOTTOM":
      props.textAlignVertical = "bottom";
      break;
  }

  // Line height
  if (node.lineHeight !== undefined) {
    if (typeof node.lineHeight === "number") {
      props.lineHeight = node.lineHeight;
    } else if (node.lineHeight.unit === "PIXELS" && node.fontSize) {
      props.lineHeight = node.lineHeight.value / node.fontSize;
    } else if (node.lineHeight.unit === "PERCENT") {
      props.lineHeight = node.lineHeight.value / 100;
    }
  }

  // Letter spacing
  if (node.letterSpacing !== undefined) {
    if (typeof node.letterSpacing === "number") {
      props.letterSpacing = node.letterSpacing;
    } else if (node.letterSpacing.unit === "PIXELS") {
      props.letterSpacing = node.letterSpacing.value;
    } else if (node.letterSpacing.unit === "PERCENT" && node.fontSize) {
      props.letterSpacing = (node.letterSpacing.value / 100) * node.fontSize;
    }
  }

  if (node.textDecoration === "UNDERLINE") props.underline = true;
  if (node.textDecoration === "STRIKETHROUGH") props.strikethrough = true;

  const transform = mapTextCase(node.textCase);
  if (transform) props.textTransform = transform;

  const widthMode = mapTextAutoResize(node.textAutoResize);
  if (widthMode) props.textWidthMode = widthMode;

  if (node.paragraphSpacing) props.paragraphSpacing = node.paragraphSpacing;
  if (node.maxLines && node.maxLines >= 1) props.maxLines = node.maxLines;

  if (node.hyperlink) {
    const url = node.hyperlink.value ?? node.hyperlink.url;
    if (url && node.hyperlink.type !== "NODE") props.link = { url };
  }

  // Text color from first solid fill.
  const { hex, opacity } = firstSolidHex(node.fills);
  if (hex) props.fill = hex;
  if (opacity !== undefined) props.fillOpacity = opacity;

  return props;
}

function selectVectorGeometries(node: PixsoNode): {
  geometries: PixsoGeometry[];
  source: "fillGeometry" | "strokeGeometry" | null;
} {
  if (node.fillGeometry && node.fillGeometry.length > 0) {
    return { geometries: node.fillGeometry, source: "fillGeometry" };
  }
  if (node.strokeGeometry && node.strokeGeometry.length > 0) {
    return { geometries: node.strokeGeometry, source: "strokeGeometry" };
  }
  return { geometries: [], source: null };
}

const CONTAINER_TYPES = new Set([
  "FRAME",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
  "SECTION",
]);
// Roots/organizational wrappers that emit no node of their own — recurse into
// their children instead.
const WRAPPER_TYPES = new Set(["DOCUMENT", "PAGE", "CANVAS"]);
// Types with no visual representation we can import.
const SKIP_TYPES = new Set(["SLICE"]);

// --- Main conversion ---

export function convertPixsoNode(
  node: PixsoNode,
  ctx: PixsoImportContext = {},
): SceneNode | null {
  if (!node || !node.type) return null;
  if (SKIP_TYPES.has(node.type)) return null;

  const id = generateId();
  const base: Record<string, unknown> = {
    id,
    x: node.x ?? 0,
    y: node.y ?? 0,
    width: node.width ?? 100,
    height: node.height ?? 100,
  };
  if (node.name) base.name = node.name;
  if (node.visible === false) base.visible = false;
  // Figma/Pixso rotation is counter-clockwise degrees; the scene graph (Pixi)
  // is clockwise — negate.
  if (node.rotation && node.rotation !== 0) base.rotation = -node.rotation;
  if (node.opacity !== undefined && node.opacity < 1) base.opacity = node.opacity;

  // Appearance — fills / gradient / image stack.
  const { fill, fillOpacity, gradientFill, fills } = buildFills(node.fills, ctx);
  const strokeWidthPerSide = extractPerSideStroke(node);
  const { stroke, strokeWidth, strokeOpacity, strokes } = extractStroke(
    node.strokes,
    node.strokeWeight,
    strokeWidthPerSide !== undefined,
    ctx,
  );
  const strokeAlign = mapStrokeAlign(node.strokeAlign);
  const effects = extractEffects(node.effects);

  if (fills) base.fills = fills;
  else {
    if (fill) base.fill = fill;
    if (fillOpacity !== undefined) base.fillOpacity = fillOpacity;
    if (gradientFill) base.gradientFill = gradientFill;
  }
  if (strokes) base.strokes = strokes;
  else {
    if (stroke) base.stroke = stroke;
    if (strokeOpacity !== undefined) base.strokeOpacity = strokeOpacity;
  }
  if (strokeWidth) base.strokeWidth = strokeWidth;
  if (strokeWidthPerSide) base.strokeWidthPerSide = strokeWidthPerSide;
  if (strokeAlign) base.strokeAlign = strokeAlign;
  if (effects) base.effects = effects;

  const type = node.type;

  if (CONTAINER_TYPES.has(type)) {
    return buildFrame(node, base, ctx);
  }

  switch (type) {
    case "GROUP": {
      const children = convertChildren(node, ctx);
      const group: GroupNode = {
        ...(base as Omit<GroupNode, "type" | "children">),
        type: "group",
        children,
      };
      return group;
    }

    case "RECTANGLE": {
      const { cornerRadius, cornerRadiusPerCorner } = extractCornerRadius(node);
      const rect: RectNode = { ...(base as Omit<RectNode, "type">), type: "rect" };
      if (cornerRadius) rect.cornerRadius = cornerRadius;
      if (cornerRadiusPerCorner) rect.cornerRadiusPerCorner = cornerRadiusPerCorner;
      if (node.cornerSmoothing) rect.cornerSmoothing = node.cornerSmoothing;
      return rect;
    }

    case "ELLIPSE": {
      const ellipse: EllipseNode = {
        ...(base as Omit<EllipseNode, "type">),
        type: "ellipse",
      };
      if (node.arcData) {
        const { startingAngle, endingAngle, innerRadius } = node.arcData;
        const startDeg = (startingAngle * 180) / Math.PI;
        const sweepDeg = ((endingAngle - startingAngle) * 180) / Math.PI;
        if (startDeg !== 0) ellipse.startAngle = startDeg;
        if (Math.abs(sweepDeg) < 360 - 1e-6 && sweepDeg !== 0) ellipse.sweepAngle = sweepDeg;
        if (innerRadius > 0) ellipse.innerRadiusRatio = innerRadius;
      }
      return ellipse;
    }

    case "POLYGON":
    case "REGULAR_POLYGON":
    case "STAR": {
      const isStar = type === "STAR";
      const sides = isStar ? (node.pointCount ?? 5) : (node.pointCount ?? 6);
      const innerRadiusRatio = isStar ? (node.innerRadius ?? 0.5) : undefined;
      const w = base.width as number;
      const h = base.height as number;
      const points = generatePolygonPoints(sides, w, h, innerRadiusRatio);
      const polygon: PolygonNode = {
        ...(base as Omit<
          PolygonNode,
          "type" | "points" | "sides" | "innerRadiusRatio"
        >),
        type: "polygon",
        points,
        sides,
        ...(innerRadiusRatio !== undefined ? { innerRadiusRatio } : {}),
      };
      return polygon;
    }

    case "VECTOR":
    case "BOOLEAN_OPERATION":
      return buildVector(node, base, {
        fill,
        fillOpacity,
        gradientFill,
        fills,
        effects,
        stroke,
        strokeWidth,
        strokeAlign: node.strokeAlign,
      });

    case "LINE": {
      const w = base.width as number;
      const line: LineNode = {
        ...(base as Omit<LineNode, "type" | "points">),
        type: "line",
        points: [0, 0, w, 0],
      };
      return line;
    }

    case "TEXT": {
      const textProps = extractTextProps(node);
      const text: TextNode = {
        ...(base as Omit<TextNode, "type" | "text">),
        type: "text",
        text: textProps.text ?? "",
      };
      if (textProps.fill) text.fill = textProps.fill;
      if (textProps.fillOpacity !== undefined) text.fillOpacity = textProps.fillOpacity;
      if (textProps.fontSize) text.fontSize = textProps.fontSize;
      if (textProps.fontFamily) text.fontFamily = textProps.fontFamily;
      if (textProps.fontWeight) text.fontWeight = textProps.fontWeight;
      if (textProps.fontStyle) text.fontStyle = textProps.fontStyle;
      if (textProps.textAlign) text.textAlign = textProps.textAlign;
      if (textProps.textAlignVertical) text.textAlignVertical = textProps.textAlignVertical;
      if (textProps.lineHeight !== undefined) text.lineHeight = textProps.lineHeight;
      if (textProps.letterSpacing !== undefined) text.letterSpacing = textProps.letterSpacing;
      if (textProps.underline) text.underline = textProps.underline;
      if (textProps.strikethrough) text.strikethrough = textProps.strikethrough;
      if (textProps.textTransform) text.textTransform = textProps.textTransform;
      if (textProps.textWidthMode) text.textWidthMode = textProps.textWidthMode;
      if (textProps.paragraphSpacing) text.paragraphSpacing = textProps.paragraphSpacing;
      if (textProps.maxLines) text.maxLines = textProps.maxLines;
      if (textProps.link) text.link = textProps.link;
      return text;
    }

    default:
      // Unknown / unsupported type: keep the layout by falling back to a
      // container (if it has children) or a rectangle placeholder.
      if (node.children && node.children.length > 0) {
        console.warn(`[pixso-import] Unknown container type "${type}" → frame fallback.`);
        return buildFrame(node, base, ctx);
      }
      console.warn(`[pixso-import] Unknown leaf type "${type}" → rect fallback.`);
      return { ...(base as Omit<RectNode, "type">), type: "rect" };
  }
}

function convertChildren(node: PixsoNode, ctx: PixsoImportContext): SceneNode[] {
  const parentLayoutMode = node.layoutMode;
  return (node.children ?? [])
    .map((child) => {
      const converted = convertPixsoNode(child, ctx);
      if (converted) {
        const { absolutePosition, sizing } = extractChildLayoutProps(
          child,
          parentLayoutMode,
        );
        if (absolutePosition) converted.absolutePosition = true;
        if (sizing) {
          converted.sizing = { ...(converted.sizing ?? {}), ...sizing };
        }
      }
      return converted;
    })
    .filter((n): n is SceneNode => n !== null);
}

function buildFrame(
  node: PixsoNode,
  base: Record<string, unknown>,
  ctx: PixsoImportContext,
): FrameNode {
  const children = convertChildren(node, ctx);
  const { layout, sizing } = extractLayout(node);
  const { cornerRadius, cornerRadiusPerCorner } = extractCornerRadius(node);
  const frame: FrameNode = {
    ...(base as Omit<FrameNode, "type" | "children">),
    type: "frame",
    children,
  };
  if (cornerRadius) frame.cornerRadius = cornerRadius;
  if (cornerRadiusPerCorner) frame.cornerRadiusPerCorner = cornerRadiusPerCorner;
  if (node.cornerSmoothing) frame.cornerSmoothing = node.cornerSmoothing;
  if (node.clipsContent) frame.clip = true;
  if (layout) frame.layout = layout;
  if (sizing) frame.sizing = sizing;
  const grids = mapLayoutGrids(node.layoutGrids);
  if (grids) frame.layoutGrids = grids;
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") frame.reusable = true;
  return frame;
}

function buildVector(
  node: PixsoNode,
  base: Record<string, unknown>,
  appearance: {
    fill?: string;
    fillOpacity?: number;
    gradientFill?: GradientFill;
    fills?: Paint[];
    effects?: Effect[];
    stroke?: string;
    strokeWidth?: number;
    strokeAlign?: string;
  },
): SceneNode {
  const { fill, fillOpacity, gradientFill, fills, effects, stroke, strokeWidth, strokeAlign } =
    appearance;
  const pathStroke: PathNode["pathStroke"] =
    stroke || strokeWidth
      ? {
          fill: stroke,
          thickness: strokeWidth,
          join: "round",
          cap: "round",
          align:
            strokeAlign === "INSIDE"
              ? "inside"
              : strokeAlign === "OUTSIDE"
                ? "outside"
                : "center",
        }
      : undefined;

  const { geometries, source } = selectVectorGeometries(node);
  if (!geometries || geometries.length === 0) {
    console.warn(
      `[pixso-import] VECTOR node "${node.name}" (${node.id}) has no fillGeometry/strokeGeometry; falling back to rect`,
    );
    return { ...(base as Omit<RectNode, "type">), type: "rect" };
  }

  const pathNodes: PathNode[] = [];
  for (const geo of geometries) {
    if (!geo.path) continue;
    const bbox = getPathBBox(geo.path);
    if (bbox.width <= 0 && bbox.height <= 0) continue;

    const pathNode: PathNode = {
      id: generateId(),
      type: "path",
      x: 0,
      y: 0,
      width: Math.max(1, bbox.width),
      height: Math.max(1, bbox.height),
      geometry: geo.path,
      geometryBounds: bbox,
    };
    if (node.name) pathNode.name = node.name;
    if (node.visible === false) pathNode.visible = false;
    // Prefer the full paint stack when present; otherwise legacy fill/gradient.
    if (fills && source !== "strokeGeometry") {
      pathNode.fills = fills;
    } else {
      if (fill && source !== "strokeGeometry") pathNode.fill = fill;
      if (fillOpacity !== undefined) pathNode.fillOpacity = fillOpacity;
      if (gradientFill && source !== "strokeGeometry") pathNode.gradientFill = gradientFill;
    }
    if (pathStroke) pathNode.pathStroke = pathStroke;
    if (geo.windingRule === "EVENODD") pathNode.fillRule = "evenodd";

    pathNodes.push(pathNode);
  }

  if (pathNodes.length === 0) {
    return { ...(base as Omit<RectNode, "type">), type: "rect" };
  }

  if (pathNodes.length === 1) {
    const single = pathNodes[0];
    single.x = base.x as number;
    single.y = base.y as number;
    single.width = base.width as number;
    single.height = base.height as number;
    if (base.rotation) single.rotation = base.rotation as number;
    if (base.opacity !== undefined) single.opacity = base.opacity as number;
    if (effects) single.effects = effects;
    return single;
  }

  const groupX = base.x as number;
  const groupY = base.y as number;
  for (const p of pathNodes) {
    p.x = (p.geometryBounds?.x ?? 0) - (pathNodes[0].geometryBounds?.x ?? 0);
    p.y = (p.geometryBounds?.y ?? 0) - (pathNodes[0].geometryBounds?.y ?? 0);
  }
  const group: GroupNode = {
    id: base.id as string,
    type: "group",
    x: groupX,
    y: groupY,
    width: base.width as number,
    height: base.height as number,
    children: pathNodes,
  };
  if (node.name) group.name = node.name;
  if (node.visible === false) group.visible = false;
  if (base.rotation) group.rotation = base.rotation as number;
  if (base.opacity !== undefined) group.opacity = base.opacity as number;
  if (effects) group.effects = effects;
  return group;
}

/**
 * Parse a Pixso JSON string into one or more root SceneNodes. Accepts a bare
 * exported node, an `{ data: node }` wrapper (optionally with an `images` map
 * of `hash → dataURL`), or a `DOCUMENT`/`PAGE` container (whose descendants are
 * unwrapped to real roots).
 */
export function parsePixsoNodes(jsonString: string): SceneNode[] {
  const parsed = JSON.parse(jsonString);
  const root = parsed?.data ?? parsed;
  const imageMap = normalizeImageMap(parsed?.images ?? parsed?.data?.images);
  const ctx: PixsoImportContext = imageMap ? { imageMap } : {};

  const roots = collectRoots(root);
  const nodes = roots
    .map((n) => convertPixsoNode(n, ctx))
    .filter((n): n is SceneNode => n !== null);
  return nodes;
}

/**
 * Unwrap DOCUMENT/PAGE/CANVAS wrappers to the first level of real (drawable)
 * nodes. A wrapper's children may themselves be wrappers (DOCUMENT → PAGE →
 * nodes), so recurse until we hit non-wrapper nodes.
 */
function collectRoots(node: unknown): PixsoNode[] {
  if (!node || typeof node !== "object") return [];
  const n = node as PixsoNode;
  if (Array.isArray(node)) {
    return (node as PixsoNode[]).flatMap(collectRoots);
  }
  if (n.type && WRAPPER_TYPES.has(n.type)) {
    return (n.children ?? []).flatMap(collectRoots);
  }
  return [n];
}

function normalizeImageMap(
  raw: unknown,
): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      out[key] = value.startsWith("data:")
        ? value
        : `data:image/png;base64,${value}`;
    } else if (value && typeof value === "object") {
      // Some exporters nest as { bytes | data | url }.
      const v = value as { bytes?: string; data?: string; url?: string };
      const s = v.url ?? v.data ?? v.bytes;
      if (typeof s === "string") {
        out[key] = s.startsWith("data:") ? s : `data:image/png;base64,${s}`;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Back-compatible single-root parse. Returns the first converted root node.
 * Prefer `parsePixsoNodes` for documents with multiple roots.
 */
export function parsePixsoJson(jsonString: string): SceneNode {
  const nodes = parsePixsoNodes(jsonString);
  if (nodes.length === 0) {
    throw new Error("Failed to convert: unsupported node type or empty data");
  }
  return nodes[0];
}
