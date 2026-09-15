import { memo, useCallback, useMemo, type ReactNode } from "react";
import type { SceneNode, FrameNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import type { FlatParentContext, ParentContext } from "@/utils/nodeUtils";
import { useSceneStore } from "@/store/sceneStore";
import { TypeSection } from "@/components/properties/TypeSection";
import { PositionSection } from "@/components/properties/PositionSection";
import { AlignmentControls } from "@/components/properties/AlignmentSection";
import { SizeSection } from "@/components/properties/SizeSection";
import { ConstraintsSection } from "@/components/properties/ConstraintsSection";
import { AutoLayoutSection } from "@/components/properties/AutoLayoutSection";
import { LayoutGridSection } from "@/components/properties/LayoutGridSection";
import { AppearanceSection } from "@/components/properties/AppearanceSection";
import { FillSection } from "@/components/properties/FillSection";
import { StrokeSection } from "@/components/properties/StrokeSection";
import { EffectsSection } from "@/components/properties/EffectsSection";
import { ShaderSection } from "@/components/properties/ShaderSection";
import { ThemeSection } from "@/components/properties/ThemeSection";
import { TypographySection } from "@/components/properties/TypographySection";
import { EmbedContentSection } from "@/components/properties/EmbedContentSection";
import { FrameActionsSection } from "@/components/properties/FrameActionsSection";
import { SelectionColorsSection } from "@/components/properties/SelectionColorsSection";
import { ExportSettingsSection } from "@/components/properties/ExportSettingsSection";

interface PropertyEditorProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  parentContext: ParentContext | FlatParentContext;
  variables: Variable[];
  activeTheme: ThemeName;
  beforeExport?: ReactNode;
}

export const PropertyEditor = memo(function PropertyEditor({
  node,
  onUpdate,
  parentContext,
  variables,
  activeTheme,
  beforeExport,
}: PropertyEditorProps) {
  const frameNode = node.type === "frame" ? (node as FrameNode) : null;

  const colorVariables = useMemo(
    () => variables.filter((v) => v.type === "color"),
    [variables],
  );

  const selectionNodes = useMemo(() => [node], [node]);

  const enableAutoLayoutOnFrame = useSceneStore((s) => s.enableAutoLayoutOnFrame);
  const handleEnableAutoLayout = useCallback(() => {
    enableAutoLayoutOnFrame(node.id);
  }, [enableAutoLayoutOnFrame, node.id]);

  return (
    <div className="flex flex-col">
      <TypeSection node={node} onUpdate={onUpdate} />
      <PositionSection
        node={node}
        onUpdate={onUpdate}
        parentContext={parentContext}
        alignment={
          parentContext.parent && !parentContext.isInsideAutoLayout ? (
            <AlignmentControls
              count={1}
              selectedIds={[node.id]}
              parentFrame={parentContext.parent}
            />
          ) : undefined
        }
      />
      <SizeSection node={node} onUpdate={onUpdate} parentContext={parentContext} />
      {parentContext.parent &&
        parentContext.parent.type === "frame" &&
        !parentContext.isInsideAutoLayout && (
          <ConstraintsSection node={node} onUpdate={onUpdate} />
        )}
      {node.type === "frame" && (
        <AutoLayoutSection
          node={node}
          onUpdate={onUpdate}
          onEnableAutoLayout={handleEnableAutoLayout}
        />
      )}
      {node.type === "frame" && (
        <LayoutGridSection node={node} onUpdate={onUpdate} />
      )}
      <AppearanceSection node={node} onUpdate={onUpdate} />
      <FillSection
        node={node}
        onUpdate={onUpdate}
        colorVariables={colorVariables}
        activeTheme={activeTheme}
      />
      <StrokeSection
        node={node}
        onUpdate={onUpdate}
        colorVariables={colorVariables}
        activeTheme={activeTheme}
      />
      <EffectsSection node={node} onUpdate={onUpdate} />
      <ShaderSection node={node} onUpdate={onUpdate} />
      {frameNode && (
        <ThemeSection node={frameNode} onUpdate={onUpdate} />
      )}
      {node.type === "text" && (
        <TypographySection node={node} onUpdate={onUpdate} />
      )}
      {(node.type === "frame" || node.type === "group") && (
        <FrameActionsSection node={node} />
      )}
      {node.type === "embed" && (
        <EmbedContentSection node={node} />
      )}
      <SelectionColorsSection nodes={selectionNodes} />
      {beforeExport}
      <ExportSettingsSection node={node} onUpdate={onUpdate} />
    </div>
  );
});
