import type { SceneNode, FlatFrameNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import { findComponentById, type ParentContext } from "@/utils/nodeUtils";
import { useSceneStore } from "@/store/sceneStore";
import { isInsideReusableComponent } from "@/utils/componentUtils";
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
import { TypographySection } from "@/components/properties/TypographySection";
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

  const slotFlatNode = useSceneStore((s) => {
    if (node.type !== "frame") return null;
    const hasChildren = (s.childrenById[node.id] ?? []).length > 0;
    if (hasChildren && !(node as unknown as FlatFrameNode).isSlot) return null;
    if (!isInsideReusableComponent(node.id, s.nodesById, s.parentById)) return null;
    return s.nodesById[node.id] as FlatFrameNode;
  });

  const colorVariables = variables.filter((v) => v.type === "color");

  return (
    <div className="flex flex-col">
      <TypeSection
        node={node}
        onUpdate={onUpdate}
        typeLabelOverride={
          node.type === "ref"
            ? `Instance of ${component?.name || "Component"}`
            : undefined
        }
        slotNode={slotFlatNode}
      />
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
