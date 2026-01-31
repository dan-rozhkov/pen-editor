import { useState } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import type { SceneNode } from "@/types/scene";
import {
  findNodeById,
  findParentFrame,
  type ParentContext,
} from "@/utils/nodeUtils";
import { AlignmentSection } from "@/components/properties/AlignmentSection";
import { DescendantPropertyEditor } from "@/components/properties/DescendantPropertyEditor";
import { ExportSection } from "@/components/properties/ExportSection";
import { PageProperties } from "@/components/properties/PageProperties";
import { PropertyEditor } from "@/components/properties/PropertyEditor";
import { VariablesDialog } from "@/components/VariablesPanel";
import { SlidersHorizontal } from "@phosphor-icons/react";

export function PropertiesPanel() {
  const nodes = useSceneStore((s) => s.nodes);
  const updateNode = useSceneStore((s) => s.updateNode);
  const { selectedIds, instanceContext } = useSelectionStore();
  const variables = useVariableStore((s) => s.variables);
  const activeTheme = useThemeStore((s) => s.activeTheme);
  const [variablesOpen, setVariablesOpen] = useState(false);

  const selectedNode =
    selectedIds.length === 1 ? findNodeById(nodes, selectedIds[0]) : null;

  const parentContext: ParentContext = selectedNode
    ? findParentFrame(nodes, selectedNode.id)
    : { parent: null, isInsideAutoLayout: false };

  const handleUpdate = (updates: Partial<SceneNode>) => {
    if (selectedNode) {
      updateNode(selectedNode.id, updates);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {selectedIds.length === 0 && <PageProperties />}
        {selectedIds.length === 0 && (
          <div className="px-4 py-3 border-b border-border-light">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-text-primary">
                Variables
              </span>
              <button
                onClick={() => setVariablesOpen(true)}
                className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
                title="Open variables panel"
              >
                <SlidersHorizontal size={14} />
              </button>
            </div>
          </div>
        )}
        {selectedIds.length > 1 && (
          <AlignmentSection
            count={selectedIds.length}
            selectedIds={selectedIds}
            nodes={nodes}
          />
        )}
        {/* If editing a descendant inside an instance, show descendant editor */}
        {instanceContext && (
          <DescendantPropertyEditor
            instanceContext={instanceContext}
            allNodes={nodes}
            variables={variables}
            activeTheme={activeTheme}
          />
        )}
        {/* Otherwise show normal property editor */}
        {selectedNode && !instanceContext && (
          <PropertyEditor
            node={selectedNode}
            onUpdate={handleUpdate}
            parentContext={parentContext}
            variables={variables}
            activeTheme={activeTheme}
            allNodes={nodes}
          />
        )}
        {/* Export section - always visible at the bottom */}
        <ExportSection selectedNode={selectedNode} />
      </div>
      <VariablesDialog open={variablesOpen} onOpenChange={setVariablesOpen} />
    </div>
  );
}
