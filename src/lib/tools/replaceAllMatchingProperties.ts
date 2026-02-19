import { useSceneStore } from "@/store/sceneStore";
import { createSnapshot, saveHistory } from "@/store/sceneStore/helpers/history";
import type { FlatSceneNode, LayoutProperties } from "@/types/scene";
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

    // fillColor → fill (all nodes)
    if (rules.fillColor) {
      applyColorRules(rules.fillColor, "fill", "fillBinding");
    }

    // textColor → fill (text nodes only)
    if (rules.textColor && node.type === "text") {
      applyColorRules(rules.textColor, "fill", "fillBinding");
    }

    // strokeColor → stroke
    if (rules.strokeColor) {
      applyColorRules(rules.strokeColor, "stroke", "strokeBinding");
    }

    // strokeThickness → strokeWidth
    if (rules.strokeThickness) {
      for (const rule of rules.strokeThickness) {
        if (node.strokeWidth === rule.from) {
          updated = updated ?? { ...node };
          (updated as unknown as Record<string, unknown>).strokeWidth = rule.to;
          replacements++;
        }
      }
    }

    // fontSize (text only)
    if (rules.fontSize && node.type === "text") {
      for (const rule of rules.fontSize) {
        if (node.fontSize === rule.from) {
          updated = updated ?? { ...node };
          (updated as unknown as Record<string, unknown>).fontSize = rule.to;
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
        if (node.fontWeight === rule.from) {
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
        if (nodeAny.cornerRadius === rule.from) {
          updated = updated ?? { ...node };
          (updated as unknown as Record<string, unknown>).cornerRadius = rule.to;
          replacements++;
        }
      }
    }

    // padding (frame only, in layout)
    if (rules.padding && node.type === "frame") {
      const nodeAny = node as unknown as Record<string, unknown>;
      const layout = nodeAny.layout as LayoutProperties | undefined;
      if (layout) {
        for (const rule of rules.padding) {
          const fromVal = rule.from as number;
          if (
            layout.paddingTop === fromVal ||
            layout.paddingRight === fromVal ||
            layout.paddingBottom === fromVal ||
            layout.paddingLeft === fromVal
          ) {
            updated = updated ?? { ...node };
            const toVal = rule.to as number;
            const newLayout = { ...layout };
            if (newLayout.paddingTop === fromVal) newLayout.paddingTop = toVal;
            if (newLayout.paddingRight === fromVal) newLayout.paddingRight = toVal;
            if (newLayout.paddingBottom === fromVal) newLayout.paddingBottom = toVal;
            if (newLayout.paddingLeft === fromVal) newLayout.paddingLeft = toVal;
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
          if (layout.gap === rule.from) {
            updated = updated ?? { ...node };
            const newLayout = { ...layout, gap: rule.to as number };
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
