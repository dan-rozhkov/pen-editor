import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore, type InstanceContext } from "@/store/selectionStore";
import type { InstanceOverrideUpdateProps, RefNode, SceneNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import { findComponentById, findNodeById } from "@/utils/nodeUtils";
import { findNodeByPath } from "@/utils/instanceRuntime";
import {
  CheckboxInput,
  ColorInput,
  NumberInput,
  PropertySection,
} from "@/components/ui/PropertyInputs";
import { OverrideIndicator } from "@/components/properties/OverrideIndicator";

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
  const exitInstanceEditMode = useSelectionStore((s) => s.exitInstanceEditMode);

  const instance = findNodeById(allNodes, instanceContext.instanceId) as RefNode | null;
  if (!instance || instance.type !== "ref") return null;

  const component = findComponentById(allNodes, instance.componentId);
  if (!component) return null;

  const originalNode = findNodeByPath(component.children, instanceContext.descendantPath);
  if (!originalNode) return null;

  const isRootSlot =
    !instanceContext.descendantPath.includes("/") &&
    (component.slot?.includes(instanceContext.descendantPath) ?? false);
  const currentOverride = instance.overrides?.[instanceContext.descendantPath];
  const isReplaced = currentOverride?.kind === "replace";
  const updateProps = currentOverride?.kind === "update" ? currentOverride.props : {};
  const sourceNode =
    currentOverride?.kind === "replace" ? currentOverride.node : originalNode;
  const displayNode = isReplaced
    ? sourceNode
    : ({ ...originalNode, ...updateProps } as SceneNode);
  const colorVariables = variables.filter((v) => v.type === "color");

  const isPropertyOverridden = (property: keyof InstanceOverrideUpdateProps): boolean =>
    currentOverride?.kind === "update" && currentOverride.props[property] !== undefined;

  const handleUpdate = (updates: Partial<SceneNode>) => {
    if (isReplaced) {
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

  return (
    <div className="flex flex-col gap-4">
      <PropertySection title="Selected Instance Element">
        <div className="text-xs text-purple-400">{originalNode.name || originalNode.type}</div>
        {isRootSlot && !isReplaced && (
          <button
            onClick={() => replaceInstanceNode(instanceContext.instanceId, instanceContext.descendantPath, originalNode)}
            className="mt-2 px-3 py-1.5 bg-purple-500/20 border border-purple-500/30 rounded text-purple-400 text-xs cursor-pointer transition-colors hover:bg-purple-500/30"
          >
            Replace Slot
          </button>
        )}
        <button
          onClick={exitInstanceEditMode}
          className="mt-2 px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-text-secondary text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
        >
          Exit Edit Mode
        </button>
      </PropertySection>

      <PropertySection title="Visibility">
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <CheckboxInput
              label="Enabled"
              checked={displayNode.enabled !== false}
              onChange={(v) => handleUpdate({ enabled: v ? undefined : false })}
            />
          </div>
          <OverrideIndicator isOverridden={isPropertyOverridden("enabled")} onReset={() => handleResetProperty("enabled")} />
        </div>
      </PropertySection>

      <PropertySection title="Fill">
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <ColorInput
              value={displayNode.fill ?? originalNode.fill ?? "#000000"}
              onChange={(v) => handleUpdate({ fill: v })}
              variableId={displayNode.fillBinding?.variableId}
              onVariableChange={(variableId) => handleUpdate({ fillBinding: variableId ? { variableId } : undefined })}
              availableVariables={colorVariables}
              activeTheme={activeTheme}
            />
          </div>
          <OverrideIndicator isOverridden={isPropertyOverridden("fill")} onReset={() => handleResetProperty("fill")} />
        </div>
      </PropertySection>

      <PropertySection title="Stroke">
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <ColorInput
              value={displayNode.stroke ?? originalNode.stroke ?? ""}
              onChange={(v) => handleUpdate({ stroke: v || undefined })}
              variableId={displayNode.strokeBinding?.variableId}
              onVariableChange={(variableId) => handleUpdate({ strokeBinding: variableId ? { variableId } : undefined })}
              availableVariables={colorVariables}
              activeTheme={activeTheme}
            />
          </div>
          <OverrideIndicator isOverridden={isPropertyOverridden("stroke")} onReset={() => handleResetProperty("stroke")} />
        </div>
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <NumberInput
              label="Weight"
              labelOutside
              value={displayNode.strokeWidth ?? originalNode.strokeWidth ?? 0}
              onChange={(v) => handleUpdate({ strokeWidth: v })}
              min={0}
              step={0.5}
            />
          </div>
          <OverrideIndicator
            isOverridden={isPropertyOverridden("strokeWidth")}
            onReset={() => handleResetProperty("strokeWidth")}
          />
        </div>
      </PropertySection>

      <PropertySection title="Overrides">
        <button
          onClick={handleResetAll}
          className="px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-text-secondary text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
        >
          {isReplaced ? "Reset Replacement" : "Reset All Overrides"}
        </button>
      </PropertySection>
    </div>
  );
}
