import type {
  FlatSceneNode,
  LayoutProperties,
  SizingProperties,
  SceneNode,
  ImageFill,
  ImageCropRect,
  Paint,
  PatternFill,
  VideoFill,
  GradientFill,
  PerCornerRadius,
  ConstraintMode,
  NodeConstraints,
  ParagraphAttrs,
} from "@/types/scene";
import type { ThemeName } from "@/types/variable";
import { generateId } from "@/types/scene";
import { syncTextDimensions } from "@/store/sceneStore/helpers/textSync";
import { resolveVariableReference } from "@/lib/tools/variableResolutionUtils";
import {
  clearLegacyFillProps,
  createDefaultVideoPlayback,
  createGradientPaint,
  createImagePaint,
  createPatternPaint,
  createSolidPaint,
  createVideoPaint,
} from "@/utils/fillUtils";
import { generatePolygonPoints } from "@/utils/polygonUtils";
import { normalizeParagraphs, splitParagraphs } from "@/lib/textLists/paragraphs";
import { parseMarkdownLink } from "@/lib/textLink";

/** AI node data as received from the operations script */
type AiNodeData = Record<string, unknown>;

/** Map MCP type names to internal scene node types */
const TYPE_MAP: Record<string, string> = {
  rectangle: "rect",
};

function mapNodeType(mcpType: string): string {
  return TYPE_MAP[mcpType] ?? mcpType;
}

/**
 * Node types that can render a pattern (or image) sprite paint. Mirrors the UI
 * gate (`FillSection.tsx` `supportsImage`) — path/line/polygon/text/etc. have
 * no image-fill rendering path, so a pattern paint on them would silently
 * paint nothing (see `drawPathFillStack` for paths, which explicitly skips
 * pattern/image paints).
 */
const PATTERN_SUPPORTED_NODE_TYPES = new Set(["rect", "ellipse", "frame"]);

/** Resolve a color variable reference (e.g. "$color") and set both value and binding. */
function applyColorVariable(
  result: Record<string, unknown>,
  key: string,
  value: unknown,
  theme?: ThemeName,
): void {
  const resolvedVariable = resolveVariableReference(value, theme);
  if (resolvedVariable) {
    result[`${key}Binding`] = { variableId: resolvedVariable.variableId };
    result[key] = resolvedVariable.variableValue;
  } else {
    result[key] = value;
  }
}


/**
 * Normalize a single AI-format paint entry into a typed Paint object.
 *
 * Accepted forms (id is always generated, never taken from the model):
 *   solid:    {type:"solid", color, opacity?, visible?, blendMode?, colorBinding?}
 *   gradient: {type:"gradient", gradient:{...}}  OR  flat GradientFill fields
 *             ({type:"gradient", stops, startX, ...})
 *   image:    {type:"image", url, mode}  OR  {type:"image", image:{url, mode}}
 *   pattern:  {type:"pattern", url, scale?, spacingX?, spacingY?, offsetX?,
 *             offsetY?, rowOffset?}  OR  {type:"pattern", pattern:{...}}
 *
 * For solid paints a `$--var` reference in `color` is resolved to its value and
 * a `colorBinding` is attached (mirrors the legacy single-`fill` behavior).
 * Returns null for entries that cannot be interpreted.
 */
/** Parse an AI-provided crop rect ({x,y,width,height} in 0-1) into an ImageCropRect, or undefined. */
function normalizeCropRect(value: unknown): ImageCropRect | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const x = num(raw.x);
  const y = num(raw.y);
  const width = num(raw.width);
  const height = num(raw.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return { x, y, width, height };
}

function normalizePaint(
  entry: unknown,
  theme?: ThemeName,
  nodeType?: string,
  warnings?: string[],
): Paint | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const raw = entry as Record<string, unknown>;
  const type = typeof raw.type === "string" ? raw.type : undefined;

  // Common pass-through paint props.
  const common: { opacity?: number; visible?: boolean; blendMode?: Paint["blendMode"] } = {};
  if (typeof raw.opacity === "number") common.opacity = raw.opacity;
  if (typeof raw.visible === "boolean") common.visible = raw.visible;
  if (typeof raw.blendMode === "string") {
    common.blendMode = raw.blendMode as Paint["blendMode"];
  }

  // ── Pattern paint ──────────────────────────────────────────────
  // Accept both flat ({type:"pattern", url, scale?, ...}) and nested
  // ({type:"pattern", pattern:{url, ...}}). Honor the discriminator: only
  // treat as pattern when explicitly typed "pattern", or when untyped AND a
  // `pattern` object is present — an explicit `{type:"image", pattern:{...}}`
  // (or any other typed entry) must not be silently reinterpreted.
  if (type === "pattern" || (type === undefined && raw.pattern !== undefined)) {
    if (nodeType !== undefined && !PATTERN_SUPPORTED_NODE_TYPES.has(nodeType)) {
      warnings?.push(
        `Pattern fill is not supported on "${nodeType}" nodes (only rect/ellipse/frame) — the paint was dropped.`,
      );
      return null;
    }
    const nested =
      raw.pattern && typeof raw.pattern === "object"
        ? (raw.pattern as Record<string, unknown>)
        : raw;
    const url = nested.url;
    if (typeof url !== "string") return null;
    const num = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isFinite(v) ? v : undefined;
    const pattern: PatternFill = { url };
    const scale = num(nested.scale);
    if (scale !== undefined) pattern.scale = scale;
    const spacingX = num(nested.spacingX);
    if (spacingX !== undefined) pattern.spacingX = spacingX;
    const spacingY = num(nested.spacingY);
    if (spacingY !== undefined) pattern.spacingY = spacingY;
    const offsetX = num(nested.offsetX);
    if (offsetX !== undefined) pattern.offsetX = offsetX;
    const offsetY = num(nested.offsetY);
    if (offsetY !== undefined) pattern.offsetY = offsetY;
    const rowOffset = num(nested.rowOffset);
    if (rowOffset !== undefined) pattern.rowOffset = rowOffset;
    return createPatternPaint(pattern, common);
  }

  // ── Video paint ────────────────────────────────────────────────
  // Accept both flat ({type:"video", src|url, mode, loop?, muted?, autoplay?,
  // crop?}) and nested ({type:"video", video:{...}}). Requires an explicit
  // "video" discriminator (untyped {url} defaults to image, below) OR a nested
  // `video` object. Only rect/ellipse/frame can render a video fill.
  if (type === "video" || (type === undefined && raw.video !== undefined)) {
    if (nodeType !== undefined && !PATTERN_SUPPORTED_NODE_TYPES.has(nodeType)) {
      warnings?.push(
        `Video fill is not supported on "${nodeType}" nodes (only rect/ellipse/frame) — the paint was dropped.`,
      );
      return null;
    }
    const nested =
      raw.video && typeof raw.video === "object"
        ? (raw.video as Record<string, unknown>)
        : raw;
    const src = nested.src ?? nested.url;
    if (typeof src !== "string") return null;
    const mode =
      nested.mode === "fit" || nested.mode === "stretch" ? nested.mode : "fill";
    const playback = createDefaultVideoPlayback();
    if (typeof nested.autoplay === "boolean") playback.autoplay = nested.autoplay;
    if (typeof nested.loop === "boolean") playback.loop = nested.loop;
    if (typeof nested.muted === "boolean") playback.muted = nested.muted;
    const video: VideoFill = { src, mode, playback };
    const crop = normalizeCropRect(nested.crop);
    if (crop) video.crop = crop;
    if (typeof nested.videoId === "string") video.videoId = nested.videoId;
    return createVideoPaint(video, common);
  }

  // ── Image paint ────────────────────────────────────────────────
  // Accept both flat ({type:"image", url, mode}) and nested ({image:{url,mode}}).
  if (type === "image" || raw.image !== undefined || (raw.url !== undefined && type === undefined && raw.color === undefined)) {
    const nested =
      raw.image && typeof raw.image === "object"
        ? (raw.image as Record<string, unknown>)
        : raw;
    const url = nested.url;
    if (typeof url !== "string") return null;
    const mode =
      nested.mode === "fit" || nested.mode === "stretch" ? nested.mode : "fill";
    return createImagePaint({ url, mode } as ImageFill, common);
  }

  // ── Gradient paint ─────────────────────────────────────────────
  // Accept nested ({type:"gradient", gradient:{...}}) and flat GradientFill.
  if (type === "gradient" || raw.gradient !== undefined || Array.isArray(raw.stops)) {
    let gradientFill: GradientFill;
    if (raw.gradient && typeof raw.gradient === "object") {
      // Nested form: the gradient object is already a GradientFill (keeps its
      // own `type: "linear" | "radial"`).
      const nested = raw.gradient as Record<string, unknown>;
      if (!Array.isArray(nested.stops)) return null;
      gradientFill = nested as unknown as GradientFill;
    } else {
      // Flat form: GradientFill fields sit alongside the paint discriminator —
      // strip the paint-level keys (including `type: "gradient"`).
      if (!Array.isArray(raw.stops)) return null;
      const { type: _t, opacity: _o, visible: _v, blendMode: _b, ...gradientFields } =
        raw;
      gradientFill = gradientFields as unknown as GradientFill;
    }
    return createGradientPaint(gradientFill, common);
  }

  // ── Solid paint (default) ──────────────────────────────────────
  if (type === "solid" || typeof raw.color === "string") {
    const colorValue = raw.color;
    if (typeof colorValue !== "string") return null;
    const resolved = resolveVariableReference(colorValue, theme);
    if (resolved) {
      return createSolidPaint(resolved.variableValue, {
        colorBinding: { variableId: resolved.variableId },
        ...common,
      });
    }
    return createSolidPaint(colorValue, common);
  }

  return null;
}

/**
 * Normalize an AI-format `fills` value (expected: an array bottom-to-top) into a
 * typed Paint[]. Unparseable entries are dropped.
 */
function normalizeFills(
  value: unknown,
  theme?: ThemeName,
  nodeType?: string,
  warnings?: string[],
): Paint[] {
  if (!Array.isArray(value)) return [];
  const paints: Paint[] = [];
  for (const entry of value) {
    const paint = normalizePaint(entry, theme, nodeType, warnings);
    if (paint) paints.push(paint);
  }
  return paints;
}

/**
 * Expand an AI-provided cornerRadius array into a PerCornerRadius object.
 * Follows CSS `border-radius` shorthand ordering so a model can pass 1, 2, 3,
 * or 4 values just like CSS:
 *   [all]                → tl = tr = br = bl
 *   [tl_br, tr_bl]       → topLeft/bottomRight, topRight/bottomLeft
 *   [tl, tr_bl, br]      → topLeft, topRight/bottomLeft, bottomRight
 *   [tl, tr, br, bl]     → each corner independently
 * Non-finite entries fall back to 0.
 */
function expandCornerRadiusArray(value: unknown[]): PerCornerRadius {
  const n = value.map((v) =>
    typeof v === "number" && Number.isFinite(v) ? v : 0,
  );
  let tl: number, tr: number, br: number, bl: number;
  switch (n.length) {
    case 0:
      tl = tr = br = bl = 0;
      break;
    case 1:
      tl = tr = br = bl = n[0];
      break;
    case 2:
      tl = br = n[0];
      tr = bl = n[1];
      break;
    case 3:
      tl = n[0];
      tr = bl = n[1];
      br = n[2];
      break;
    default:
      [tl, tr, br, bl] = [n[0], n[1], n[2], n[3]];
  }
  return { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
}

/**
 * Parse a sizing string like "fill_container" or "fill_container(500)".
 * Returns { mode, numericValue? }
 */
function parseSizingValue(
  val: unknown
): { mode: string; numericValue?: number } | null {
  if (typeof val === "number") return null; // plain number, not a sizing string
  if (typeof val !== "string") return null;

  const match = val.match(/^(fill_container|fit_content)(?:\((\d+)\))?$/);
  if (!match) return null;
  return {
    mode: match[1],
    numericValue: match[2] ? Number(match[2]) : undefined,
  };
}

const CONSTRAINT_MODES: ConstraintMode[] = ["min", "max", "center", "stretch", "scale"];

/**
 * Normalize an AI-format `constraints` value into a well-formed
 * {horizontal, vertical} pair. Accepts Figma-ish aliases (`left`/`top` →
 * `min`, `right`/`bottom` → `max`, `left-right`/`top-bottom` → `stretch`).
 * Unknown/missing axes fall back to `"min"` (fixed, pre-constraints behavior).
 */
function normalizeConstraintMode(value: unknown): ConstraintMode {
  if (typeof value !== "string") return "min";
  const aliases: Record<string, ConstraintMode> = {
    left: "min",
    top: "min",
    right: "max",
    bottom: "max",
    "left-right": "stretch",
    "top-bottom": "stretch",
  };
  const normalized = aliases[value] ?? (value as ConstraintMode);
  return CONSTRAINT_MODES.includes(normalized) ? normalized : "min";
}

function normalizeConstraints(value: unknown): NodeConstraints | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  return {
    horizontal: normalizeConstraintMode(raw.horizontal),
    vertical: normalizeConstraintMode(raw.vertical),
  };
}

/**
 * Map AI-format node data to internal SceneNode properties.
 * For Insert: generates id and defaults.
 * For Update: returns only the mapped properties to merge.
 */
export function mapNodeData(
  data: AiNodeData,
  mode: "insert" | "update",
  existingNode?: FlatSceneNode,
  options?: { theme?: ThemeName }
): Partial<FlatSceneNode> & { _children?: AiNodeData[]; _warnings?: string[] } {
  const result: Record<string, unknown> = {};
  const layout: Partial<LayoutProperties> = {};
  const sizing: Partial<SizingProperties> = {};
  let hasLayout = false;
  let hasSizing = false;
  let children: AiNodeData[] | undefined;
  const warnings: string[] = [];
  // Effective node type for this data, used to gate paints that only some
  // node types can render (e.g. pattern fills — see PATTERN_SUPPORTED_NODE_TYPES).
  const nodeTypeForFills =
    (typeof data.type === "string" ? mapNodeType(data.type) : undefined) ??
    existingNode?.type;

  for (const [key, value] of Object.entries(data)) {
    switch (key) {
      // Layout shorthand
      case "layout": {
        if (typeof value === "string") {
          hasLayout = true;
          layout.autoLayout = true;
          layout.flexDirection =
            value === "horizontal" ? "row" : "column";
        } else if (typeof value === "object" && value !== null) {
          // Direct layout object pass-through
          hasLayout = true;
          Object.assign(layout, value);
        }
        break;
      }

      // Content → text property. A whole-content markdown link
      // `[text](url)` (optionally `[text](url "title")`) becomes the text
      // node's `link` attribute — see `parseMarkdownLink`'s doc comment for
      // why this only matches when the ENTIRE content is one link (no
      // per-character span model in this codebase).
      case "content":
      case "text": {
        const str = String(value);
        const link = parseMarkdownLink(str);
        if (link) {
          result.text = link.text;
          result.link = link.title ? { url: link.url, title: link.title } : { url: link.url };
        } else {
          result.text = str;
          // On update, re-setting content to plain (non-markdown) text removes
          // any existing link — the documented "remove a link" path in
          // tools.ts. executeUpdate's shallow merge only clears a field when
          // the key is present, so emit `link: undefined` to override it (and
          // it's dropped from `.pen` serialization). On insert there's no
          // stale link to clear, so leave the field unset.
          if (mode === "update" && existingNode && "link" in existingNode) {
            result.link = undefined;
          }
        }
        break;
      }

      // Color variable references in AI format, e.g. "$color"
      case "fill":
      case "stroke": {
        applyColorVariable(result, key, value, options?.theme);
        break;
      }

      // Figma-style paint stack (bottom-to-top). When set, it is the single
      // source of truth — clear the legacy single-fill fields so the two
      // representations never diverge.
      case "fills": {
        const paints = normalizeFills(value, options?.theme, nodeTypeForFills, warnings);
        result.fills = paints;
        Object.assign(result, clearLegacyFillProps());
        break;
      }

      // Theme shorthand
      case "theme":
      case "themeOverride": {
        if (value === "inherit" || value == null) {
          result.themeOverride = undefined;
        } else if (value === "light" || value === "dark") {
          result.themeOverride = value;
        } else if (typeof value === "object" && value !== null) {
          // Handle object format from .pen files, e.g. {"Mode": "Light"}
          const vals = Object.values(value as Record<string, string>);
          if (vals.length > 0) {
            const themeVal = String(vals[vals.length - 1]).toLowerCase();
            if (themeVal === "light" || themeVal === "dark") {
              result.themeOverride = themeVal;
            }
          }
        }
        break;
      }

      // Padding shorthand (single number → all sides)
      case "padding": {
        if (typeof value === "number") {
          hasLayout = true;
          layout.paddingTop = value;
          layout.paddingRight = value;
          layout.paddingBottom = value;
          layout.paddingLeft = value;
        }
        break;
      }

      // Gap shorthand
      case "gap": {
        if (typeof value === "number") {
          hasLayout = true;
          layout.gap = value;
        }
        break;
      }

      // Per-axis gaps (CSS row-gap/column-gap semantics) — used together with
      // wrap for card grids/tag lists; each falls back to `gap` when unset.
      case "rowGap": {
        if (typeof value === "number") {
          hasLayout = true;
          layout.rowGap = value;
        }
        break;
      }
      case "columnGap": {
        if (typeof value === "number") {
          hasLayout = true;
          layout.columnGap = value;
        }
        break;
      }

      // Wrap toggle: children flow onto new lines when the main axis runs out
      // of space.
      case "wrap": {
        if (typeof value === "boolean") {
          hasLayout = true;
          layout.flexWrap = value;
        }
        break;
      }

      // Min/max clamps applied to a child's resolved width/height inside an
      // auto-layout parent, regardless of its sizing mode.
      case "minWidth":
      case "maxWidth":
      case "minHeight":
      case "maxHeight": {
        if (typeof value === "number") {
          hasSizing = true;
          (sizing as Record<string, number>)[key] = value;
        }
        break;
      }

      // Corner radius: accept a single number (unified) or an array of radii
      // ([tl, tr, br, bl], CSS-shorthand lengths also allowed) which maps to
      // per-corner radii. Setting one representation clears the other so they
      // never diverge.
      case "cornerRadius": {
        if (Array.isArray(value)) {
          result.cornerRadiusPerCorner = expandCornerRadiusArray(value);
          result.cornerRadius = undefined;
        } else if (typeof value === "number") {
          result.cornerRadius = value;
          result.cornerRadiusPerCorner = undefined;
        }
        break;
      }

      // Per-corner radius object ({topLeft, topRight, bottomRight, bottomLeft}).
      // Clears the unified radius so per-corner takes effect unambiguously.
      case "cornerRadiusPerCorner": {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const pcr = value as Record<string, unknown>;
          const pick = (k: string): number | undefined =>
            typeof pcr[k] === "number" && Number.isFinite(pcr[k])
              ? (pcr[k] as number)
              : undefined;
          result.cornerRadiusPerCorner = {
            topLeft: pick("topLeft"),
            topRight: pick("topRight"),
            bottomRight: pick("bottomRight"),
            bottomLeft: pick("bottomLeft"),
          };
          result.cornerRadius = undefined;
        }
        break;
      }

      // Corner smoothing ("squircle"), 0-1 fraction — same convention as the
      // stored field, so no 0-100 normalization is needed here. Clamped to
      // the valid range; any other input type is ignored.
      case "cornerSmoothing": {
        if (typeof value === "number" && Number.isFinite(value)) {
          result.cornerSmoothing = Math.max(0, Math.min(1, value));
        }
        break;
      }

      // Resize constraints (Figma-style). Only meaningful for a direct child
      // of a frame WITHOUT auto-layout — ignored by auto-layout frames.
      case "constraints": {
        const normalized = normalizeConstraints(value);
        if (normalized) {
          result.constraints = normalized;
        }
        break;
      }

      // Stroke thickness alias used by some generated payloads
      case "strokeThickness": {
        if (typeof value === "number") {
          result.strokeWidth = value;
        }
        break;
      }

      // Width with sizing string support
      case "width": {
        const parsed = parseSizingValue(value);
        if (parsed) {
          hasSizing = true;
          sizing.widthMode = parsed.mode as SizingProperties["widthMode"];
          if (parsed.numericValue !== undefined) {
            result.width = parsed.numericValue;
          }
        } else if (typeof value === "number") {
          result.width = value;
        }
        break;
      }

      // Height with sizing string support
      case "height": {
        const parsed = parseSizingValue(value);
        if (parsed) {
          hasSizing = true;
          sizing.heightMode = parsed.mode as SizingProperties["heightMode"];
          if (parsed.numericValue !== undefined) {
            result.height = parsed.numericValue;
          }
        } else if (typeof value === "number") {
          result.height = value;
        }
        break;
      }

      // Type: map MCP type names to internal types
      case "type": {
        result.type = mapNodeType(String(value));
        break;
      }

      // Placeholder: MCP concept, skip
      case "placeholder":
        break;

      // Children: collect for recursive processing
      case "children": {
        if (Array.isArray(value)) {
          children = value as AiNodeData[];
        }
        break;
      }

      // positionDirection/positionPadding: copy metadata (handled by executor)
      case "positionDirection":
      case "positionPadding":
        result[key] = value;
        break;

      // Component instance property selections (RefNode.propertyValues): merge by
      // key on update so switching one property doesn't clobber others the AI
      // didn't mention in this call.
      case "propertyValues": {
        if (value && typeof value === "object") {
          const existingValues =
            mode === "update" && existingNode
              ? ((existingNode as unknown as Record<string, unknown>).propertyValues as
                  | Record<string, unknown>
                  | undefined)
              : undefined;
          result.propertyValues = { ...existingValues, ...(value as Record<string, unknown>) };
        } else {
          result.propertyValues = value;
        }
        break;
      }

      // Everything else: pass through directly
      default:
        result[key] = value;
        break;
    }
  }

  // Merge layout properties
  if (hasLayout) {
    if (mode === "update" && existingNode) {
      const existing =
        (existingNode as unknown as Record<string, unknown>)
          .layout as LayoutProperties | undefined;
      result.layout = { ...existing, ...layout };
    } else {
      result.layout = layout;
    }
  }

  // Merge sizing properties
  if (hasSizing) {
    if (mode === "update" && existingNode) {
      result.sizing = { ...existingNode.sizing, ...sizing };
    } else {
      result.sizing = sizing;
    }
  }

  // Regular polygon / star: regenerate `points` from `sides`/`innerRadiusRatio`
  // whenever either changed but the caller didn't also supply explicit
  // `points` — mirrors the properties-panel behavior (AppearanceSection),
  // so the AI can create/edit a star with just `{sides, innerRadiusRatio}`.
  const effectiveType = (result.type as string | undefined) ?? existingNode?.type;
  if (
    effectiveType === "polygon" &&
    !("points" in data) &&
    (mode === "insert" || "sides" in data || "innerRadiusRatio" in data)
  ) {
    const existingPolygon = existingNode as (FlatSceneNode & { sides?: number; innerRadiusRatio?: number }) | undefined;
    const sides = (result.sides as number | undefined) ?? existingPolygon?.sides ?? 6;
    const innerRadiusRatio =
      "innerRadiusRatio" in result
        ? (result.innerRadiusRatio as number | undefined)
        : existingPolygon?.innerRadiusRatio;
    const width = (result.width as number | undefined) ?? existingNode?.width ?? 100;
    const height = (result.height as number | undefined) ?? existingNode?.height ?? 100;
    result.points = generatePolygonPoints(sides, width, height, innerRadiusRatio);
  }

  if (children) {
    (result as Record<string, unknown>)._children = children;
  }

  if (warnings.length > 0) {
    (result as Record<string, unknown>)._warnings = warnings;
  }

  return result as Partial<FlatSceneNode> & { _children?: AiNodeData[]; _warnings?: string[] };
}

/**
 * Create a full SceneNode from AI data for insertion.
 * Recursively creates children.
 */
export function createNodeFromAiData(data: AiNodeData): SceneNode {
  return createNodeFromAiDataWithTheme(data);
}

export function createNodeFromAiDataWithTheme(
  data: AiNodeData,
  inheritedTheme?: ThemeName,
  warnings?: string[],
): SceneNode {
  const type = mapNodeType((data.type as string) ?? "frame");
  const mapped = mapNodeData(data, "insert", undefined, {
    theme: inheritedTheme,
  });
  const childrenData = mapped._children;
  delete (mapped as Record<string, unknown>)._children;
  if (mapped._warnings) {
    warnings?.push(...mapped._warnings);
    delete (mapped as Record<string, unknown>)._warnings;
  }
  const sizing = (mapped as { sizing?: SizingProperties }).sizing;
  const defaultWidth =
    sizing?.widthMode && sizing.widthMode !== "fixed" ? 0 : 100;
  const defaultHeight =
    sizing?.heightMode && sizing.heightMode !== "fixed" ? 0 : 100;

  const base = {
    id: generateId(),
    type,
    x: 0,
    y: 0,
    width: defaultWidth,
    height: defaultHeight,
    ...mapped,
  };

  // Don't override id if not already set — generateId handles it
  if (data.id) delete (base as Record<string, unknown>).id;

  if (type === "frame" || type === "group") {
    const children: SceneNode[] = [];
    const thisTheme =
      type === "frame"
        ? ((base as { themeOverride?: ThemeName }).themeOverride ?? inheritedTheme)
        : inheritedTheme;
    if (childrenData) {
      for (const childData of childrenData) {
        children.push(createNodeFromAiDataWithTheme(childData, thisTheme, warnings));
      }
    }
    return { ...base, children } as SceneNode;
  }

  // For text nodes, ensure sync
  let node = base as unknown as FlatSceneNode;
  if (type === "text") {
    const rec = node as unknown as Record<string, unknown>;
    if (!rec.text) rec.text = "";
    // If the AI supplied `paragraphs` alongside `text` (e.g. via R() replacing
    // a node while echoing back stale formatting), re-align its length to the
    // actual line count so the parallel-array invariant holds from creation —
    // mirrors the same normalization executeUpdate applies for U().
    if (rec.paragraphs !== undefined) {
      rec.paragraphs = normalizeParagraphs(
        rec.paragraphs as ParagraphAttrs[],
        splitParagraphs(rec.text as string).length,
      );
    }
    node = syncTextDimensions(node);
  }
  if (type === "line") {
    const rec = node as unknown as Record<string, unknown>;
    const points = rec.points;
    if (!Array.isArray(points) || points.length < 4) {
      const width =
        typeof rec.width === "number" && Number.isFinite(rec.width)
          ? Math.max(1, rec.width)
          : 100;
      const height =
        typeof rec.height === "number" && Number.isFinite(rec.height)
          ? Math.max(1, rec.height)
          : 1;
      const y = height / 2;
      rec.points = [0, y, width, y];
    }
  }

  return node as unknown as SceneNode;
}


/**
 * Apply an image fill to a node.
 */
export function applyImageFill(
  node: FlatSceneNode,
  url: string,
  mode: ImageFill["mode"] = "fill"
): FlatSceneNode {
  return { ...node, imageFill: { url, mode } } as FlatSceneNode;
}
