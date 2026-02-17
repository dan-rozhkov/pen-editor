import type {
  FlatSceneNode,
  LayoutProperties,
  SizingProperties,
  SceneNode,
  ImageFill,
} from "@/types/scene";
import { generateId } from "@/types/scene";
import { syncTextDimensions } from "@/store/sceneStore/helpers/textSync";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { getVariableValue } from "@/types/variable";

/** AI node data as received from the operations script */
type AiNodeData = Record<string, unknown>;

/** Map MCP type names to internal scene node types */
const TYPE_MAP: Record<string, string> = {
  rectangle: "rect",
};

function mapNodeType(mcpType: string): string {
  return TYPE_MAP[mcpType] ?? mcpType;
}

function normalizeVariableRefName(name: string): string {
  return name.trim().replace(/^\$/, "");
}

function resolveVariableByReference(
  value: unknown
): { variableId: string; variableValue: string } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("$")) return null;

  const referenceName = normalizeVariableRefName(trimmed);
  if (!referenceName) return null;

  const { variables } = useVariableStore.getState();
  const { activeTheme } = useThemeStore.getState();

  const variable = variables.find((v) => {
    const normalizedVarName = normalizeVariableRefName(v.name);
    return (
      v.name === trimmed ||
      v.name === referenceName ||
      normalizedVarName === referenceName
    );
  });

  if (!variable) return null;

  return {
    variableId: variable.id,
    variableValue: getVariableValue(variable, activeTheme),
  };
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
  existingNode?: FlatSceneNode
): Partial<FlatSceneNode> & { _children?: AiNodeData[] } {
  const result: Record<string, unknown> = {};
  let layout: Partial<LayoutProperties> = {};
  let sizing: Partial<SizingProperties> = {};
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
        const resolvedVariable = resolveVariableByReference(value);
        if (resolvedVariable) {
          result[`${key}Binding`] = { variableId: resolvedVariable.variableId };
          // Keep concrete value as fallback for contexts that don't resolve bindings.
          result[key] = resolvedVariable.variableValue;
        } else {
          result[key] = value;
        }
        break;
      }

      // Ref → componentId
      case "ref": {
        result.componentId = String(value);
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

      // Descendants: pass through for ref nodes
      case "descendants":
        result.descendants = value;
        break;

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
  const type = mapNodeType((data.type as string) ?? "frame");
  const mapped = mapNodeData(data, "insert");
  const childrenData = mapped._children;
  delete (mapped as Record<string, unknown>)._children;

  const base = {
    id: generateId(),
    type,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...mapped,
  };

  // Don't override id if not already set — generateId handles it
  if (data.id) delete (base as Record<string, unknown>).id;

  if (type === "frame" || type === "group") {
    const children: SceneNode[] = [];
    if (childrenData) {
      for (const childData of childrenData) {
        children.push(createNodeFromAiData(childData));
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

  return node as unknown as SceneNode;
}

/**
 * Map descendant override data from AI format.
 * Converts content→text and other AI shorthands.
 */
export function mapDescendantOverride(
  data: AiNodeData
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "content") {
      result.text = String(value);
    } else if (key === "fill" || key === "stroke") {
      const resolvedVariable = resolveVariableByReference(value);
      if (resolvedVariable) {
        result[`${key}Binding`] = { variableId: resolvedVariable.variableId };
        result[key] = resolvedVariable.variableValue;
      } else {
        result[key] = value;
      }
    } else if (key === "ref" || key === "placeholder") {
      // skip
    } else {
      result[key] = value;
    }
  }
  return result;
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
