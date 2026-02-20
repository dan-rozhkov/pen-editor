import { useMemo } from "react";
import type { FrameNode, SceneNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import { useSceneStore } from "@/store/sceneStore";
import { saveHistory } from "@/store/sceneStore/helpers/history";
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
import { AutoLayoutSection } from "@/components/properties/AutoLayoutSection";

interface MultiSelectPropertyEditorProps {
  selectedNodes: SceneNode[];
  variables: Variable[];
  activeTheme: ThemeName;
}

// Types that support cornerRadius
const CORNER_RADIUS_TYPES = new Set(["frame", "rect"]);

// Layout sub-properties to compare for mixed detection
const LAYOUT_SUB_KEYS = [
  "flexDirection",
  "gap",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "alignItems",
  "justifyContent",
] as const;

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

  // Auto-layout: show if any selected node is a frame with auto-layout enabled
  const autoLayoutFrames = useMemo(
    () => selectedNodes.filter(
      (n): n is FrameNode => n.type === "frame" && !!n.layout?.autoLayout,
    ),
    [selectedNodes],
  );

  const showAutoLayout = autoLayoutFrames.length > 0;

  // Compute a synthetic FrameNode and layout-specific mixed keys for auto-layout section
  const autoLayoutData = useMemo(() => {
    if (!showAutoLayout) return null;

    const baseFrame = autoLayoutFrames[0];
    const layoutMixedKeys = new Set<string>();

    // Compare layout sub-properties across all auto-layout frames
    for (const key of LAYOUT_SUB_KEYS) {
      const baseVal = baseFrame.layout?.[key];
      for (let i = 1; i < autoLayoutFrames.length; i++) {
        const otherVal = autoLayoutFrames[i].layout?.[key];
        if (baseVal !== otherVal) {
          layoutMixedKeys.add(`layout.${key}`);
          break;
        }
      }
    }

    return {
      node: baseFrame,
      mixedKeys: layoutMixedKeys,
      frameIds: autoLayoutFrames.map((n) => n.id),
    };
  }, [autoLayoutFrames, showAutoLayout]);

  // Update handler for auto-layout that only targets frame nodes with auto-layout.
  // Extracts only the actually-changed layout properties (by diffing against the
  // base node's layout) so that changing e.g. gap doesn't overwrite each node's
  // own flexDirection with the first node's value.
  const handleAutoLayoutUpdate = useMemo(() => {
    if (!autoLayoutData) return handleUpdate;
    return (updates: Partial<SceneNode>) => {
      const layoutUpdate = (updates as Partial<FrameNode>).layout;
      if (!layoutUpdate) {
        // Non-layout update (e.g. sizing) — apply as-is
        updateMultipleNodes(autoLayoutData.frameIds, updates);
        return;
      }

      // AutoLayoutSection spreads `...node.layout` into every update, so we need
      // to diff the incoming layout against the base node's layout to find only
      // the properties the user actually changed.
      const baseLayout = autoLayoutData.node.layout ?? {};
      const changedProps: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(layoutUpdate)) {
        if ((baseLayout as Record<string, unknown>)[key] !== value) {
          changedProps[key] = value;
        }
      }

      // If nothing actually changed, skip
      if (Object.keys(changedProps).length === 0) return;

      // Merge only the changed properties into each node's existing layout
      useSceneStore.setState((state) => {
        saveHistory(state);
        const newNodesById = { ...state.nodesById };
        for (const id of autoLayoutData.frameIds) {
          const existing = newNodesById[id];
          if (!existing || existing.type !== "frame") continue;
          const mergedLayout = { ...(existing as FrameNode).layout, ...changedProps };
          newNodesById[id] = { ...existing, layout: mergedLayout };
        }
        return { nodesById: newNodesById, _cachedTree: null };
      });
    };
  }, [autoLayoutData, updateMultipleNodes, handleUpdate]);

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
      {showAutoLayout && autoLayoutData && (
        <AutoLayoutSection
          node={autoLayoutData.node}
          onUpdate={handleAutoLayoutUpdate}
          mixedKeys={autoLayoutData.mixedKeys}
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
