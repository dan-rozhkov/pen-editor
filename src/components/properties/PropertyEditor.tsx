import type { SceneNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import type { ParentContext } from "@/utils/nodeUtils";
import { TypeSection } from "@/components/properties/TypeSection";
import { PositionSection } from "@/components/properties/PositionSection";
import { SizeSection } from "@/components/properties/SizeSection";
import { AutoLayoutSection } from "@/components/properties/AutoLayoutSection";
import { AppearanceSection } from "@/components/properties/AppearanceSection";
import { FillSection } from "@/components/properties/FillSection";
import { StrokeSection } from "@/components/properties/StrokeSection";
import { EffectsSection } from "@/components/properties/EffectsSection";
import { ThemeSection } from "@/components/properties/ThemeSection";
import { TypographySection } from "@/components/properties/TypographySection";
import { EmbedContentSection } from "@/components/properties/EmbedContentSection";
import { FrameActionsSection } from "@/components/properties/FrameActionsSection";


interface PropertyEditorProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  parentContext: ParentContext;
  variables: Variable[];
  activeTheme: ThemeName;
}

export function PropertyEditor({
  node,
  onUpdate,
  parentContext,
  variables,
  activeTheme,
}: PropertyEditorProps) {
  const colorVariables = variables.filter((v) => v.type === "color");

  return (
    <div className="flex flex-col">
      <TypeSection node={node} onUpdate={onUpdate} />
      <PositionSection node={node} onUpdate={onUpdate} parentContext={parentContext} />
      <SizeSection node={node} onUpdate={onUpdate} parentContext={parentContext} />
      {node.type === "frame" && (
        <AutoLayoutSection node={node} onUpdate={onUpdate} />
      )}
      <AppearanceSection node={node} onUpdate={onUpdate} />
      <FillSection
        node={node}
        onUpdate={onUpdate}
        component={null}
        colorVariables={colorVariables}
        activeTheme={activeTheme}
        isOverridden={() => false}
        resetOverride={() => {}}
      />
      <StrokeSection
        node={node}
        onUpdate={onUpdate}
        component={null}
        colorVariables={colorVariables}
        activeTheme={activeTheme}
        isOverridden={() => false}
        resetOverride={() => {}}
      />
      <EffectsSection node={node} onUpdate={onUpdate} />
      {node.type === "frame" && (
        <ThemeSection node={node} onUpdate={onUpdate} />
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
    </div>
  );
}
