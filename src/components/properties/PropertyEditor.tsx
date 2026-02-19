import type { SceneNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import { findComponentById, type ParentContext } from "@/utils/nodeUtils";
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
import { InstanceSection } from "@/components/properties/InstanceSection";


interface PropertyEditorProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  parentContext: ParentContext;
  variables: Variable[];
  activeTheme: ThemeName;
  allNodes: SceneNode[];
}

export function PropertyEditor({
  node,
  onUpdate,
  parentContext,
  variables,
  activeTheme,
  allNodes,
}: PropertyEditorProps) {
  const component =
    node.type === "ref" ? findComponentById(allNodes, node.componentId) : null;

  const isOverridden = <T,>(
    instanceVal: T | undefined,
    componentVal: T | undefined
  ): boolean => {
    if (!component) return false;
    return instanceVal !== undefined && instanceVal !== componentVal;
  };

  const resetOverride = (property: keyof SceneNode) => {
    onUpdate({ [property]: undefined } as Partial<SceneNode>);
  };

  const colorVariables = variables.filter((v) => v.type === "color");

  return (
    <div className="flex flex-col">
      <TypeSection node={node} onUpdate={onUpdate} allNodes={allNodes} />
      {node.type === "ref" && (
        <InstanceSection
          node={node}
          onUpdate={onUpdate}
          allNodes={allNodes}
          isOverridden={isOverridden}
        />
      )}
      <PositionSection node={node} onUpdate={onUpdate} />
      <SizeSection node={node} onUpdate={onUpdate} parentContext={parentContext} />
      {node.type === "frame" && (
        <AutoLayoutSection node={node} onUpdate={onUpdate} />
      )}
      <AppearanceSection node={node} onUpdate={onUpdate} />
      <FillSection
        node={node}
        onUpdate={onUpdate}
        component={component}
        colorVariables={colorVariables}
        activeTheme={activeTheme}
        isOverridden={isOverridden}
        resetOverride={resetOverride}
      />
      <StrokeSection
        node={node}
        onUpdate={onUpdate}
        component={component}
        colorVariables={colorVariables}
        activeTheme={activeTheme}
        isOverridden={isOverridden}
        resetOverride={resetOverride}
      />
      <EffectsSection node={node} onUpdate={onUpdate} />
      {node.type === "frame" && (
        <ThemeSection node={node} onUpdate={onUpdate} />
      )}
      {node.type === "text" && (
        <TypographySection node={node} onUpdate={onUpdate} />
      )}
    </div>
  );
}
