import { useSceneStore } from "@/store/sceneStore";
import { createSnapshot, saveHistory } from "@/store/sceneStore/helpers/history";
import type { FlatSceneNode, LayoutProperties, Paint, PathStroke } from "@/types/scene";
import type { ToolHandler } from "../toolRegistry";
import { resolveVariableReference } from "@/lib/tools/variableResolutionUtils";

interface ReplacementRule {
  from: unknown;
  to: unknown;
}

interface PropertyRules {
  fillColor?: ReplacementRule[];
  textColor?: ReplacementRule[];
  strokeColor?: ReplacementRule[];
  strokeThickness?: ReplacementRule[];
  fontSize?: ReplacementRule[];
  fontFamily?: ReplacementRule[];
  fontWeight?: ReplacementRule[];
  cornerRadius?: ReplacementRule[];
  cornerRadiusPerCorner?: ReplacementRule[];
  cornerSmoothing?: ReplacementRule[];
  padding?: ReplacementRule[];
  gap?: ReplacementRule[];
}

function getColorReplacement(
  value: unknown
): { colorValue: unknown; binding: { variableId: string } | undefined } {
  const variable = resolveVariableReference(value);
  if (variable) {
    return {
      colorValue: variable.variableValue,
      binding: { variableId: variable.variableId },
    };
  }
  return {
    colorValue: value,
    binding: undefined,
  };
}

function isColorEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return a === b;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Compares numeric rule values leniently: `rule.from` arrives as `unknown`
 * straight from the LLM and may be serialized as a numeric string (e.g.
 * `"2"`) even though the node stores a number. Coerce both sides with
 * `Number(...)` and compare numerically when both coerce cleanly; otherwise
 * fall back to strict equality (e.g. non-numeric `fontWeight` values like
 * `"normal"` must still match themselves, not silently fail because neither
 * side is a valid number).
 */
function numEqual(a: unknown, b: unknown): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  return a === b;
}

/**
 * Coerces a numeric rule's `to` value the same way `numEqual` coerces `from`:
 * the LLM slip that sends `from: "2"` for a numeric field almost always sends
 * `to: "4"` too, and writing that string straight into a numeric node field
 * breaks downstream layout/render math. Return the number when it coerces
 * cleanly; otherwise leave the value untouched. Only for genuinely numeric
 * fields — not `fontWeight`, which is a string field.
 */
function numValue(x: unknown): unknown {
  const n = Number(x);
  return Number.isNaN(n) ? x : n;
}

export const replaceAllMatchingProperties: ToolHandler = async (args) => {
  const parents = args.parents as string[] | undefined;
  const properties = args.properties as PropertyRules | undefined;

  if (!parents || parents.length === 0) {
    return JSON.stringify({ error: "No parent IDs provided" });
  }
  if (!properties || Object.keys(properties).length === 0) {
    return JSON.stringify({ error: "No property replacements specified" });
  }

  // Capture for closure narrowing
  const rules = properties;
  const state = useSceneStore.getState();
  const originalSnapshot = createSnapshot(state);

  const nodesById = { ...state.nodesById };
  let replacements = 0;

  function walk(nodeId: string) {
    const node = nodesById[nodeId];
    if (!node) return;

    let updated: FlatSceneNode | null = null;

    function applyColorRules(
      colorRules: ReplacementRule[],
      sourceField: "fill" | "stroke",
      bindingField: "fillBinding" | "strokeBinding",
    ) {
      const currentValue = (node as unknown as Record<string, unknown>)[sourceField] as string | undefined;
      for (const rule of colorRules) {
        if (isColorEqual(currentValue, rule.from)) {
          const replacement = getColorReplacement(rule.to);
          updated = updated ?? { ...node };
          (updated as unknown as Record<string, unknown>)[sourceField] = replacement.colorValue;
          (updated as unknown as Record<string, unknown>)[bindingField] = replacement.binding;
          replacements++;
        }
      }
    }

    /**
     * Apply color rules inside a Figma-style paint stack (`fills` or
     * `strokes`), matching/replacing the color of each SolidPaint and
     * attaching/clearing its `colorBinding` when the replacement is a
     * variable reference. Shared by the `fillColor`/`textColor` and
     * `strokeColor` rule handlers below — they differ only in which stack
     * field they read/write.
     */
    function applyPaintStackColorRules(
      colorRules: ReplacementRule[],
      stackField: "fills" | "strokes",
    ) {
      const sourceStack = (
        updated as unknown as Record<string, Paint[] | undefined> | null
      )?.[stackField] ?? node[stackField];
      if (!sourceStack) return;

      let changed = false;
      const nextStack = sourceStack.map((paint): Paint => {
        if (paint.type !== "solid") return paint;
        for (const rule of colorRules) {
          if (isColorEqual(paint.color, rule.from)) {
            const replacement = getColorReplacement(rule.to);
            changed = true;
            replacements++;
            return {
              ...paint,
              color: replacement.colorValue as string,
              colorBinding: replacement.binding,
            };
          }
        }
        return paint;
      });

      if (changed) {
        updated = updated ?? { ...node };
        (updated as unknown as Record<string, unknown>)[stackField] = nextStack;
      }
    }

    /**
     * `stroke` (legacy field) is only the resolved stroke color when it's
     * set — path nodes drawn with the pen tool instead store their color in
     * `pathStroke.fill`, with `node.stroke` left undefined (see
     * `legacyStrokesToPaints`'s `node.stroke ?? node.pathStroke?.fill`
     * priority in fillUtils.ts). Without this, `strokeColor` rules were
     * silently invisible to every path/icon node using that fallback.
     */
    function applyPathStrokeColorRule(colorRules: ReplacementRule[]) {
      if (node.type !== "path" || node.stroke !== undefined) return;
      const pathStroke = (node as unknown as Record<string, unknown>)
        .pathStroke as PathStroke | undefined;
      if (!pathStroke) return;
      for (const rule of colorRules) {
        if (isColorEqual(pathStroke.fill, rule.from)) {
          const replacement = getColorReplacement(rule.to);
          updated = updated ?? { ...node };
          (updated as unknown as Record<string, unknown>).pathStroke = {
            ...pathStroke,
            fill: replacement.colorValue,
          };
          replacements++;
        }
      }
    }

    // When `fills` is set it is the single source of truth and the renderer
    // ignores the legacy `fill` field (see fillUtils contract) — "replacing"
    // legacy `fill` there would count a no-op as a replacement.
    const hasFillsStack = node.fills !== undefined;

    // fillColor → fill + fills solid paints (all nodes)
    if (rules.fillColor) {
      if (!hasFillsStack) applyColorRules(rules.fillColor, "fill", "fillBinding");
      applyPaintStackColorRules(rules.fillColor, "fills");
    }

    // textColor → fill + fills solid paints (text nodes only)
    if (rules.textColor && node.type === "text") {
      if (!hasFillsStack) applyColorRules(rules.textColor, "fill", "fillBinding");
      applyPaintStackColorRules(rules.textColor, "fills");
    }

    // strokeColor → stroke + strokes solid paints + pathStroke.fill (icons)
    const hasStrokesStack = node.strokes !== undefined;
    if (rules.strokeColor) {
      if (!hasStrokesStack) {
        applyColorRules(rules.strokeColor, "stroke", "strokeBinding");
        applyPathStrokeColorRule(rules.strokeColor);
      }
      applyPaintStackColorRules(rules.strokeColor, "strokes");
    }

    // strokeThickness → strokeWidth
    if (rules.strokeThickness) {
      for (const rule of rules.strokeThickness) {
        if (numEqual(node.strokeWidth, rule.from)) {
          updated = updated ?? { ...node };
          (updated as unknown as Record<string, unknown>).strokeWidth = numValue(rule.to);
          replacements++;
        }
      }
    }

    // fontSize (text only)
    if (rules.fontSize && node.type === "text") {
      for (const rule of rules.fontSize) {
        if (numEqual(node.fontSize, rule.from)) {
          updated = updated ?? { ...node };
          (updated as unknown as Record<string, unknown>).fontSize = numValue(rule.to);
          replacements++;
        }
      }
    }

    // fontFamily (text only)
    if (rules.fontFamily && node.type === "text") {
      for (const rule of rules.fontFamily) {
        if (node.fontFamily === rule.from) {
          updated = updated ?? { ...node };
          (updated as unknown as Record<string, unknown>).fontFamily = rule.to;
          replacements++;
        }
      }
    }

    // fontWeight (text only)
    if (rules.fontWeight && node.type === "text") {
      for (const rule of rules.fontWeight) {
        if (numEqual(node.fontWeight, rule.from)) {
          updated = updated ?? { ...node };
          (updated as unknown as Record<string, unknown>).fontWeight = rule.to;
          replacements++;
        }
      }
    }

    // cornerRadius (frame/rect only)
    if (rules.cornerRadius && (node.type === "frame" || node.type === "rect")) {
      const nodeAny = node as unknown as Record<string, unknown>;
      for (const rule of rules.cornerRadius) {
        if (numEqual(nodeAny.cornerRadius, rule.from)) {
          updated = updated ?? { ...node };
          (updated as unknown as Record<string, unknown>).cornerRadius = numValue(rule.to);
          replacements++;
        }
      }
    }

    // cornerRadiusPerCorner (frame/rect only)
    if (rules.cornerRadiusPerCorner && (node.type === "frame" || node.type === "rect")) {
      const nodeAny = node as unknown as Record<string, unknown>;
      const current = nodeAny.cornerRadiusPerCorner as Record<string, unknown> | undefined;
      for (const rule of rules.cornerRadiusPerCorner) {
        const from = rule.from as Record<string, unknown> | undefined;
        const match = current?.topLeft === from?.topLeft &&
          current?.topRight === from?.topRight &&
          current?.bottomRight === from?.bottomRight &&
          current?.bottomLeft === from?.bottomLeft;
        if (match) {
          updated = updated ?? { ...node };
          (updated as unknown as Record<string, unknown>).cornerRadiusPerCorner = rule.to;
          replacements++;
        }
      }
    }

    // cornerSmoothing (frame/rect only)
    if (rules.cornerSmoothing && (node.type === "frame" || node.type === "rect")) {
      const nodeAny = node as unknown as Record<string, unknown>;
      for (const rule of rules.cornerSmoothing) {
        if (numEqual(nodeAny.cornerSmoothing, rule.from)) {
          updated = updated ?? { ...node };
          (updated as unknown as Record<string, unknown>).cornerSmoothing = numValue(rule.to);
          replacements++;
        }
      }
    }

    // Padding/gap rules match against the original layout (so rules don't
    // cascade into each other's output) but write into the accumulated
    // updated layout (so padding and gap rules in one call don't clobber
    // each other).
    function currentLayout(original: LayoutProperties): LayoutProperties {
      return (
        ((updated as unknown as Record<string, unknown> | null)?.layout as
          | LayoutProperties
          | undefined) ?? original
      );
    }

    // padding (frame only, in layout)
    if (rules.padding && node.type === "frame") {
      const nodeAny = node as unknown as Record<string, unknown>;
      const layout = nodeAny.layout as LayoutProperties | undefined;
      if (layout) {
        for (const rule of rules.padding) {
          const fromVal = rule.from;
          if (
            numEqual(layout.paddingTop, fromVal) ||
            numEqual(layout.paddingRight, fromVal) ||
            numEqual(layout.paddingBottom, fromVal) ||
            numEqual(layout.paddingLeft, fromVal)
          ) {
            updated = updated ?? { ...node };
            const toVal = numValue(rule.to) as number;
            const newLayout = { ...currentLayout(layout) };
            if (numEqual(layout.paddingTop, fromVal)) newLayout.paddingTop = toVal;
            if (numEqual(layout.paddingRight, fromVal)) newLayout.paddingRight = toVal;
            if (numEqual(layout.paddingBottom, fromVal)) newLayout.paddingBottom = toVal;
            if (numEqual(layout.paddingLeft, fromVal)) newLayout.paddingLeft = toVal;
            (updated as unknown as Record<string, unknown>).layout = newLayout;
            replacements++;
          }
        }
      }
    }

    // gap (frame only, in layout)
    if (rules.gap && node.type === "frame") {
      const nodeAny = node as unknown as Record<string, unknown>;
      const layout = nodeAny.layout as LayoutProperties | undefined;
      if (layout) {
        for (const rule of rules.gap) {
          if (numEqual(layout.gap, rule.from)) {
            updated = updated ?? { ...node };
            const newLayout = { ...currentLayout(layout), gap: numValue(rule.to) as number };
            (updated as unknown as Record<string, unknown>).layout = newLayout;
            replacements++;
          }
        }
      }
    }

    if (updated) {
      nodesById[nodeId] = updated;
    }

    // Recurse into children
    const childIds = state.childrenById[nodeId];
    if (childIds) {
      for (const cid of childIds) {
        walk(cid);
      }
    }
  }

  for (const pid of parents) {
    walk(pid);
  }

  if (replacements > 0) {
    saveHistory(originalSnapshot);
    useSceneStore.setState({
      nodesById,
      _cachedTree: null,
    });
  }

  return JSON.stringify({ success: true, replacements });
};
