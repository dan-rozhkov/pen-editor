import type { SceneNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import { findComponentById, type ParentContext } from "@/utils/nodeUtils";
import { TypeSection } from "@/components/properties/TypeSection";
import { PositionSection } from "@/components/properties/PositionSection";
import { SizeSection } from "@/components/properties/SizeSection";
import { AutoLayoutSection } from "@/components/properties/AutoLayoutSection";
import { LayoutGridSection } from "@/components/properties/LayoutGridSection";
import { AppearanceSection } from "@/components/properties/AppearanceSection";
import { FillSection } from "@/components/properties/FillSection";
import { StrokeSection } from "@/components/properties/StrokeSection";
import { EffectsSection } from "@/components/properties/EffectsSection";
import { ThemeSection } from "@/components/properties/ThemeSection";
import { InstanceSection } from "@/components/properties/InstanceSection";
import { TypographySection } from "@/components/properties/TypographySection";
import { SlotsSection } from "@/components/properties/SlotsSection";
import { EmbedContentSection } from "@/components/properties/EmbedContentSection";
import { FrameActionsSection } from "@/components/properties/FrameActionsSection";

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
  const frameNode = node.type === "frame" ? node : null;

  const isOverridden = <T,>(instanceVal: T | undefined, componentVal: T | undefined): boolean => {
    if (!component) return false;
    return instanceVal !== undefined && instanceVal !== componentVal;
  };

  const resetOverride = (property: keyof SceneNode) => {
    onUpdate({ [property]: undefined } as Partial<SceneNode>);
  };

  const colorVariables = variables.filter((v) => v.type === "color");

  return (
    <div className="flex flex-col">
      <TypeSection node={node} onUpdate={onUpdate} />
      <PositionSection node={node} onUpdate={onUpdate} parentContext={parentContext} />
      <SizeSection node={node} onUpdate={onUpdate} parentContext={parentContext} />
      {node.type === "frame" && (
        <AutoLayoutSection node={node} onUpdate={onUpdate} />
      )}
      {node.type === "frame" && (
        <LayoutGridSection node={node} onUpdate={onUpdate} />
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
      {frameNode && (
        <ThemeSection node={frameNode} onUpdate={onUpdate} />
      )}
      {frameNode?.reusable && (
        <SlotsSection
          node={frameNode}
          childNodes={frameNode.children}
        />
      )}
      {node.type === "ref" && (
        <InstanceSection
          node={node}
          onUpdate={onUpdate}
          allNodes={allNodes}
          isOverridden={isOverridden}
        />
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
