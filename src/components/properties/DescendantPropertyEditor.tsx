import { useSceneStore } from "@/store/sceneStore";
import type { InstanceContext } from "@/store/selectionStore";
import type { SceneNode, DescendantOverride, RefNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import { findComponentById, findNodeById, getAllComponents } from "@/utils/nodeUtils";
import {
  ColorInput,
  NumberInput,
  PropertySection,
} from "@/components/ui/PropertyInputs";

import { Eye, EyeSlash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";


interface DescendantPropertyEditorProps {
  instanceContext: InstanceContext;
  allNodes: SceneNode[];
  variables: Variable[];
  activeTheme: ThemeName;
}

function findNodeInComponent(
  children: SceneNode[],
  nodeId: string,
): SceneNode | null {
  for (const child of children) {
    if (child.id === nodeId) return child;
    if (child.type === "frame" || child.type === "group") {
      const found = findNodeInComponent(child.children, nodeId);
      if (found) return found;
    }
  }
  return null;
}

export function DescendantPropertyEditor({
  instanceContext,
  allNodes,
  variables,
  activeTheme,
}: DescendantPropertyEditorProps) {
  const updateDescendantOverride = useSceneStore(
    (s) => s.updateDescendantOverride,
  );
  const resetDescendantOverride = useSceneStore(
    (s) => s.resetDescendantOverride,
  );
  const replaceSlotContent = useSceneStore((s) => s.replaceSlotContent);
  const resetSlotContent = useSceneStore((s) => s.resetSlotContent);
  const updateSlotContentNode = useSceneStore((s) => s.updateSlotContentNode);
  const instance = findNodeById(
    allNodes,
    instanceContext.instanceId,
  ) as RefNode | null;
  if (!instance || instance.type !== "ref") return null;

  const component = findComponentById(allNodes, instance.componentId);
  if (!component) return null;

  const originalNode = findNodeInComponent(
    component.children,
    instanceContext.descendantId,
  );
  if (!originalNode) return null;

  // Slot detection — components (ref nodes) inside components are automatically slots
  const isSlot = originalNode.type === 'ref';
  const slotContentNode = instance.slotContent?.[instanceContext.descendantId];
  const isSlotReplaced = isSlot && !!slotContentNode;

  const currentOverride =
    instance.descendants?.[instanceContext.descendantId] || {};

  // If slot is replaced, display the replacement node; otherwise apply overrides
  const displayNode = isSlotReplaced
    ? slotContentNode!
    : ({ ...originalNode, ...currentOverride } as SceneNode);

  const isPropertyOverridden = (
    property: keyof DescendantOverride,
  ): boolean => {
    return currentOverride[property] !== undefined;
  };

  const handleUpdate = (updates: Partial<SceneNode>) => {
    if (isSlotReplaced) {
      updateSlotContentNode(
        instanceContext.instanceId,
        instanceContext.descendantId,
        updates,
      );
    } else {
      updateDescendantOverride(
        instanceContext.instanceId,
        instanceContext.descendantId,
        updates as DescendantOverride,
      );
    }
  };

  const handleResetProperty = (property: keyof DescendantOverride) => {
    resetDescendantOverride(
      instanceContext.instanceId,
      instanceContext.descendantId,
      property,
    );
  };

  const handleResetAll = () => {
    if (isSlotReplaced) {
      resetSlotContent(instanceContext.instanceId, instanceContext.descendantId);
    } else {
      resetDescendantOverride(
        instanceContext.instanceId,
        instanceContext.descendantId,
      );
    }
  };

  // Component swap for ref/slot descendants
  const availableComponents = isSlot ? getAllComponents(allNodes) : [];

  // Get current component ID for the slot
  const currentSlotComponentId = isSlotReplaced
    ? (slotContentNode?.type === 'ref' ? (slotContentNode as RefNode).componentId : null)
    : (originalNode as RefNode).componentId;

  const handleComponentSwap = (newComponentId: string) => {
    if (newComponentId === '__reset__') {
      resetSlotContent(instanceContext.instanceId, instanceContext.descendantId);
      return;
    }

    const newComponent = findComponentById(allNodes, newComponentId);
    if (!newComponent) return;

    replaceSlotContent(
      instanceContext.instanceId,
      instanceContext.descendantId,
      {
        ...newComponent,
        id: originalNode.id,
        name: originalNode.name ?? newComponent.name,
        x: originalNode.x,
        y: originalNode.y,
        width: originalNode.width,
        height: originalNode.height,
        reusable: false,
      },
    );
  };

  const colorVariables = variables.filter((v) => v.type === "color");

  const handleFillVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      handleUpdate({ fillBinding: { variableId } });
    } else {
      handleUpdate({ fillBinding: undefined });
    }
  };

  const handleStrokeVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      handleUpdate({ strokeBinding: { variableId } });
    } else {
      handleUpdate({ strokeBinding: undefined });
    }
  };

  const overriddenProperties: string[] = [];
  if (isPropertyOverridden("fill")) overriddenProperties.push("Fill");
  if (isPropertyOverridden("stroke")) overriddenProperties.push("Stroke");
  if (isPropertyOverridden("strokeWidth"))
    overriddenProperties.push("Stroke Width");
  if (isPropertyOverridden("enabled")) overriddenProperties.push("Enabled");
  if (isPropertyOverridden("fillBinding"))
    overriddenProperties.push("Fill Variable");
  if (isPropertyOverridden("strokeBinding"))
    overriddenProperties.push("Stroke Variable");

  return (
    <div className="flex flex-col">
      <PropertySection title="Type">
        <div className="text-xs text-text-secondary capitalize">
          {originalNode.name || originalNode.type}
        </div>
        {/* Component swap dropdown for ref/slot descendants */}
        {isSlot && availableComponents.length > 0 && (
          <div className="mt-2">
            <label className="text-[10px] text-text-muted block mb-1">Component</label>
            <select
              value={currentSlotComponentId ?? ''}
              onChange={(e) => handleComponentSwap(e.target.value)}
              className="w-full text-xs bg-surface-elevated border border-border-light rounded px-2 py-1.5 text-text-primary cursor-pointer transition-colors hover:border-border-hover focus:outline-none focus:border-purple-500"
            >
              {availableComponents.map((comp) => (
                <option key={comp.id} value={comp.id}>
                  {comp.name || comp.id}
                </option>
              ))}
              {isSlotReplaced && (
                <option value="__reset__">Reset to original</option>
              )}
            </select>
          </div>
        )}
        {isSlot && !isSlotReplaced && availableComponents.length === 0 && (
          <button
            onClick={() => {
              const slotComponent = findComponentById(allNodes, (originalNode as RefNode).componentId);
              if (slotComponent) {
                replaceSlotContent(
                  instanceContext.instanceId,
                  instanceContext.descendantId,
                  {
                    ...slotComponent,
                    id: originalNode.id,
                    name: originalNode.name ?? slotComponent.name,
                    x: originalNode.x,
                    y: originalNode.y,
                    width: originalNode.width,
                    height: originalNode.height,
                    reusable: false,
                  },
                );
              }
            }}
            className="mt-2 px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-text-secondary text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
          >
            Replace Slot
          </button>
        )}
        {isSlotReplaced && availableComponents.length === 0 && (
          <button
            onClick={handleResetAll}
            className="mt-2 px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-text-secondary text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
          >
            Reset Slot
          </button>
        )}
      </PropertySection>

      <PropertySection title="Appearance">
        <div className="flex items-end gap-1">
          <div className="flex-1">
            <NumberInput
              label="Opacity %"
              value={Math.round((displayNode.opacity ?? 1) * 100)}
              onChange={(v) =>
                handleUpdate({ opacity: Math.max(0, Math.min(100, v)) / 100 })
              }
              min={0}
              max={100}
              step={1}
              labelOutside={true}
            />
          </div>
          <button
            onClick={() => handleUpdate({ enabled: displayNode.enabled === false ? undefined : false })}
            className={`h-6 w-6 flex items-center justify-center rounded bg-surface-elevated transition-colors ${displayNode.enabled !== false ? "text-text-muted hover:text-text-primary" : "text-text-muted opacity-50 hover:text-text-primary"}`}
            title={displayNode.enabled !== false ? "Hide" : "Show"}
          >
            {displayNode.enabled !== false ? (
              <Eye size={14} weight="regular" />
            ) : (
              <EyeSlash size={14} weight="regular" />
            )}
          </button>
        </div>
      </PropertySection>

      <PropertySection title="Fill">
        <ColorInput
          value={displayNode.fill ?? originalNode.fill ?? "#000000"}
          onChange={(v) => handleUpdate({ fill: v })}
          variableId={displayNode.fillBinding?.variableId}
          onVariableChange={handleFillVariableChange}
          availableVariables={colorVariables}
          activeTheme={activeTheme}
        />
      </PropertySection>

      <PropertySection title="Stroke">
        <ColorInput
          value={displayNode.stroke ?? originalNode.stroke ?? ""}
          onChange={(v) => handleUpdate({ stroke: v || undefined })}
          variableId={displayNode.strokeBinding?.variableId}
          onVariableChange={handleStrokeVariableChange}
          availableVariables={colorVariables}
          activeTheme={activeTheme}
        />
        <NumberInput
          label="Weight"
          labelOutside={true}
          value={displayNode.strokeWidth ?? originalNode.strokeWidth ?? 0}
          onChange={(v) => handleUpdate({ strokeWidth: v })}
          min={0}
          step={0.5}
        />
      </PropertySection>

      {!isSlotReplaced && overriddenProperties.length > 0 && (
        <PropertySection title="Overrides">
          <div className="text-xs text-text-secondary mb-2">
            {overriddenProperties.join(", ")}
          </div>
          <Button onClick={handleResetAll} variant="secondary" className="w-full">
            Reset All Overrides
          </Button>
        </PropertySection>
      )}
    </div>
  );
}
