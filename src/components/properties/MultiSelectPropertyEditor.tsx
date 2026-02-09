import { useMemo } from "react";
import type { SceneNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import { useSceneStore } from "@/store/sceneStore";
import {
  computeMergedProperties,
  getSharedSections,
} from "@/utils/multiSelectUtils";
import { PositionSection } from "@/components/properties/PositionSection";
import { SizeSection } from "@/components/properties/SizeSection";
import { AppearanceSection } from "@/components/properties/AppearanceSection";
import { FillSection } from "@/components/properties/FillSection";
import { StrokeSection } from "@/components/properties/StrokeSection";
import { EffectsSection } from "@/components/properties/EffectsSection";

interface MultiSelectPropertyEditorProps {
  selectedNodes: SceneNode[];
  variables: Variable[];
  activeTheme: ThemeName;
}

// Types that support cornerRadius
const CORNER_RADIUS_TYPES = new Set(["frame", "rect"]);

export function MultiSelectPropertyEditor({
  selectedNodes,
  variables,
  activeTheme,
}: MultiSelectPropertyEditorProps) {
  const updateMultipleNodes = useSceneStore((s) => s.updateMultipleNodes);

  const merged = useMemo(
    () => computeMergedProperties(selectedNodes),
    [selectedNodes],
  );

  const sharedSections = useMemo(
    () => getSharedSections(merged.types),
    [merged.types],
  );

  const ids = useMemo(
    () => selectedNodes.map((n) => n.id),
    [selectedNodes],
  );

  const handleUpdate = (updates: Partial<SceneNode>) => {
    updateMultipleNodes(ids, updates);
  };

  const colorVariables = useMemo(
    () => variables.filter((v) => v.type === "color"),
    [variables],
  );

  // For appearance section: check if ALL selected node types support cornerRadius
  const allSupportCornerRadius = useMemo(
    () => selectedNodes.every((n) => CORNER_RADIUS_TYPES.has(n.type)),
    [selectedNodes],
  );

  // Neutral overrides for FillSection/StrokeSection
  const noopIsOverridden = () => false;
  const noopResetOverride = () => {};

  // For fill/stroke: show section as "has fill" if any node has it
  const anyHasFill = selectedNodes.some(
    (n) => !!(n.fill || n.gradientFill || n.imageFill),
  );
  const anyHasStroke = selectedNodes.some(
    (n) =>
      !!(
        n.stroke ||
        (n.strokeWidth && n.strokeWidth > 0) ||
        (n.strokeWidthPerSide &&
          (n.strokeWidthPerSide.top ||
            n.strokeWidthPerSide.right ||
            n.strokeWidthPerSide.bottom ||
            n.strokeWidthPerSide.left))
      ),
  );

  // Build a synthetic node for fill/stroke that has fill/stroke if any node does
  const fillNode = useMemo(() => {
    if (anyHasFill && !merged.node.fill && !merged.node.gradientFill && !merged.node.imageFill) {
      return { ...merged.node, fill: "#000000" } as SceneNode;
    }
    return merged.node;
  }, [merged.node, anyHasFill]);

  const strokeNode = useMemo(() => {
    if (anyHasStroke && !merged.node.stroke && !(merged.node.strokeWidth && merged.node.strokeWidth > 0)) {
      return { ...merged.node, stroke: "#000000", strokeWidth: 1 } as SceneNode;
    }
    return merged.node;
  }, [merged.node, anyHasStroke]);

  const neutralParentContext = { parent: null, isInsideAutoLayout: false };

  return (
    <div className="flex flex-col">
      {sharedSections.has("position") && (
        <PositionSection
          node={merged.node}
          onUpdate={handleUpdate}
          mixedKeys={merged.mixedKeys}
        />
      )}
      {sharedSections.has("size") && (
        <SizeSection
          node={merged.node}
          onUpdate={handleUpdate}
          parentContext={neutralParentContext}
          mixedKeys={merged.mixedKeys}
          isMultiSelect
        />
      )}
      {sharedSections.has("appearance") && (
        <AppearanceSection
          node={merged.node}
          onUpdate={handleUpdate}
          mixedKeys={merged.mixedKeys}
          allTypesSupport={{ cornerRadius: allSupportCornerRadius }}
        />
      )}
      {sharedSections.has("fill") && (
        <FillSection
          node={fillNode}
          onUpdate={handleUpdate}
          component={null}
          colorVariables={colorVariables}
          activeTheme={activeTheme}
          isOverridden={noopIsOverridden}
          resetOverride={noopResetOverride}
          mixedKeys={merged.mixedKeys}
        />
      )}
      {sharedSections.has("stroke") && (
        <StrokeSection
          node={strokeNode}
          onUpdate={handleUpdate}
          component={null}
          colorVariables={colorVariables}
          activeTheme={activeTheme}
          isOverridden={noopIsOverridden}
          resetOverride={noopResetOverride}
          mixedKeys={merged.mixedKeys}
        />
      )}
      {sharedSections.has("effects") && (
        <EffectsSection
          node={merged.node}
          onUpdate={handleUpdate}
          mixedKeys={merged.mixedKeys}
        />
      )}
    </div>
  );
}
