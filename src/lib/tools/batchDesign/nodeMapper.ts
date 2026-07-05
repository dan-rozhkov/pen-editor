import type {
  FlatSceneNode,
  LayoutProperties,
  SizingProperties,
  SceneNode,
  ImageFill,
  Paint,
  GradientFill,
  PerCornerRadius,
} from "@/types/scene";
import type { ThemeName } from "@/types/variable";
import { generateId } from "@/types/scene";
import { syncTextDimensions } from "@/store/sceneStore/helpers/textSync";
import { resolveVariableReference } from "@/lib/tools/variableResolutionUtils";
import {
  clearLegacyFillProps,
  createGradientPaint,
  createImagePaint,
  createSolidPaint,
} from "@/utils/fillUtils";

/** AI node data as received from the operations script */
type AiNodeData = Record<string, unknown>;

/** Map MCP type names to internal scene node types */
const TYPE_MAP: Record<string, string> = {
  rectangle: "rect",
};

function mapNodeType(mcpType: string): string {
  return TYPE_MAP[mcpType] ?? mcpType;
}

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
 *
 * For solid paints a `$--var` reference in `color` is resolved to its value and
 * a `colorBinding` is attached (mirrors the legacy single-`fill` behavior).
 * Returns null for entries that cannot be interpreted.
 */
function normalizePaint(entry: unknown, theme?: ThemeName): Paint | null {
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
function normalizeFills(value: unknown, theme?: ThemeName): Paint[] {
  if (!Array.isArray(value)) return [];
  const paints: Paint[] = [];
  for (const entry of value) {
    const paint = normalizePaint(entry, theme);
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
): Partial<FlatSceneNode> & { _children?: AiNodeData[] } {
  const result: Record<string, unknown> = {};
  const layout: Partial<LayoutProperties> = {};
  const sizing: Partial<SizingProperties> = {};
  let hasLayout = false;
  let hasSizing = false;
  let children: AiNodeData[] | undefined;

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

      // Content → text property
      case "content": {
        result.text = String(value);
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
        const paints = normalizeFills(value, options?.theme);
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

  if (children) {
    (result as Record<string, unknown>)._children = children;
  }

  return result as Partial<FlatSceneNode> & { _children?: AiNodeData[] };
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
): SceneNode {
  const type = mapNodeType((data.type as string) ?? "frame");
  const mapped = mapNodeData(data, "insert", undefined, {
    theme: inheritedTheme,
  });
  const childrenData = mapped._children;
  delete (mapped as Record<string, unknown>)._children;
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
        children.push(createNodeFromAiDataWithTheme(childData, thisTheme));
      }
    }
    return { ...base, children } as SceneNode;
  }

  // For text nodes, ensure sync
  let node = base as unknown as FlatSceneNode;
  if (type === "text") {
    const rec = node as unknown as Record<string, unknown>;
    if (!rec.text) rec.text = "";
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
