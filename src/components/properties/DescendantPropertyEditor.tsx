import { useSceneStore } from "@/store/sceneStore";
import { type InstanceContext } from "@/store/selectionStore";
import type { InstanceOverrideUpdateProps, RefNode, SceneNode } from "@/types/scene";
import { isContainerNode, type FrameNode, type GroupNode, type TextNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import { findComponentById, findNodeById } from "@/utils/nodeUtils";
import { findNodeByPath, resolveRefToTree } from "@/utils/instanceRuntime";
import { findSlotContext } from "@/utils/componentUtils";
import {
  NumberInput,
  PropertySection,
} from "@/components/ui/PropertyInputs";
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
import { Button } from "@/components/ui/button";
import { Eye, EyeSlash } from "@phosphor-icons/react";

function getParentContextForDescendant(
  component: FrameNode,
  descendantPath: string,
): { parent: FrameNode | GroupNode | null; isInsideAutoLayout: boolean } {
  const segments = descendantPath.split("/");
  let siblings: SceneNode[] = component.children;
  let parent: FrameNode | GroupNode | null = component;

  // Walk to the second-to-last segment to find the parent of the target node
  for (let i = 0; i < segments.length - 1; i++) {
    const node = siblings.find((child) => child.id === segments[i]);
    if (!node || !isContainerNode(node)) break;
    parent = node;
    siblings = node.children;
  }

  return {
    parent,
    isInsideAutoLayout: parent?.type === "frame" && !!parent.layout?.autoLayout,
  };
}

interface DescendantPropertyEditorProps {
  instanceContext: InstanceContext;
  allNodes: SceneNode[];
  variables: Variable[];
  activeTheme: ThemeName;
}

export function DescendantPropertyEditor({
  instanceContext,
  allNodes,
  variables,
  activeTheme,
}: DescendantPropertyEditorProps) {
  const updateInstanceOverride = useSceneStore((s) => s.updateInstanceOverride);
  const replaceInstanceNode = useSceneStore((s) => s.replaceInstanceNode);
  const resetInstanceOverride = useSceneStore((s) => s.resetInstanceOverride);
  const updateSlotChildWithoutHistory = useSceneStore((s) => s.updateSlotChildWithoutHistory);
  const nodesById = useSceneStore((s) => s.nodesById);
  const childrenById = useSceneStore((s) => s.childrenById);

  const instance = findNodeById(allNodes, instanceContext.instanceId) as RefNode | null;
  if (!instance || instance.type !== "ref") return null;

  const component = findComponentById(allNodes, instance.componentId);
  if (!component) return null;

  // Look up node in component definition first, then fall back to resolved instance tree
  let originalNode = findNodeByPath(component.children, instanceContext.descendantPath);
  let resolvedTree: FrameNode | null = null;
  if (!originalNode) {
    resolvedTree = resolveRefToTree(instance, nodesById, childrenById);
    if (resolvedTree) {
      originalNode = findNodeByPath(resolvedTree.children, instanceContext.descendantPath, nodesById, childrenById);
    }
  }
  if (!originalNode) return null;

  const currentOverride = instance.overrides?.[instanceContext.descendantPath];
  const isReplaced = currentOverride?.kind === "replace";
  const updateProps = currentOverride?.kind === "update" ? currentOverride.props : {};
  const sourceNode =
    currentOverride?.kind === "replace" ? currentOverride.node : originalNode;
  const displayNode = isReplaced
    ? sourceNode
    : ({ ...originalNode, ...updateProps } as SceneNode);
  const colorVariables = variables.filter((v) => v.type === "color");
  // Use resolved tree for parent context when node is inside a replaced slot
  const parentContextSource = resolvedTree ?? component;
  const parentContext = getParentContextForDescendant(parentContextSource, instanceContext.descendantPath);

  // Find the slot path if this node is inside a replaced slot
  const slotContext = resolvedTree ? findSlotContext(instanceContext.descendantPath, instance.overrides) : null;

  const handleUpdate = (updates: Partial<SceneNode>) => {
    if (slotContext) {
      // Node is inside a replaced slot — update within the replacement tree
      updateSlotChildWithoutHistory(
        instanceContext.instanceId,
        slotContext.slotPath,
        slotContext.relativePath,
        updates,
      );
    } else if (isReplaced) {
      replaceInstanceNode(
        instanceContext.instanceId,
        instanceContext.descendantPath,
        { ...sourceNode, ...updates } as SceneNode,
      );
    } else {
      updateInstanceOverride(
        instanceContext.instanceId,
        instanceContext.descendantPath,
        updates as InstanceOverrideUpdateProps,
      );
    }
  };

  const handleResetProperty = (property: keyof InstanceOverrideUpdateProps) => {
    resetInstanceOverride(instanceContext.instanceId, instanceContext.descendantPath, property);
  };

  const handleResetAll = () => {
    resetInstanceOverride(instanceContext.instanceId, instanceContext.descendantPath);
  };

  const isOverridden = <T,>(instanceVal: T | undefined, componentVal: T | undefined): boolean =>
    instanceVal !== undefined && instanceVal !== componentVal;

  return (
    <div className="flex flex-col">
      <TypeSection node={displayNode} onUpdate={handleUpdate} />

      <PropertySection title="Visibility">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <NumberInput
              label="Opacity %"
              labelOutside
              value={Math.round((displayNode.opacity ?? 1) * 100)}
              onChange={(value) => {
                handleUpdate({ opacity: Math.max(0, Math.min(100, value)) / 100 });
              }}
              min={0}
              max={100}
              step={1}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            onClick={() => handleUpdate({ enabled: displayNode.enabled === false ? undefined : false })}
            title={displayNode.enabled === false ? "Show element" : "Hide element"}
            aria-label={displayNode.enabled === false ? "Show element" : "Hide element"}
          >
            {displayNode.enabled === false ? <EyeSlash size={14} /> : <Eye size={14} />}
          </Button>
        </div>
      </PropertySection>
      <PositionSection node={displayNode} onUpdate={handleUpdate} parentContext={parentContext} />
      <SizeSection
        node={displayNode}
        onUpdate={handleUpdate}
        parentContext={parentContext}
        useDirectUpdateOnly
      />
      {displayNode.type === "frame" && (
        <AutoLayoutSection node={displayNode} onUpdate={handleUpdate} />
      )}
      <AppearanceSection node={displayNode} onUpdate={handleUpdate} hideOpacity />
      <FillSection
        node={displayNode}
        onUpdate={handleUpdate}
        component={originalNode}
        colorVariables={colorVariables}
        activeTheme={activeTheme}
        isOverridden={isOverridden}
        resetOverride={(property) => handleResetProperty(property as keyof InstanceOverrideUpdateProps)}
      />
      <StrokeSection
        node={displayNode}
        onUpdate={handleUpdate}
        component={originalNode}
        colorVariables={colorVariables}
        activeTheme={activeTheme}
        isOverridden={isOverridden}
        resetOverride={(property) => handleResetProperty(property as keyof InstanceOverrideUpdateProps)}
      />
      <EffectsSection node={displayNode} onUpdate={handleUpdate} />
      {displayNode.type === "frame" && (
        <ThemeSection node={displayNode} onUpdate={handleUpdate} />
      )}
      {displayNode.type === "text" && (
        <TypographySection node={displayNode as TextNode} onUpdate={handleUpdate} />
      )}

      <PropertySection title="Overrides">
        <Button onClick={handleResetAll} variant="secondary" className="w-full">
          {isReplaced ? "Reset Replacement" : "Reset All Overrides"}
        </Button>
      </PropertySection>
    </div>
  );
}
