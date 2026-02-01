import { useState } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useViewportStore } from "@/store/viewportStore";
import type { SceneNode, FrameNode } from "@/types/scene";
import { generateId } from "@/types/scene";
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

const FRAME_PRESETS = [
  {
    category: "Mobile",
    presets: [
      { name: "iPhone 16 Pro Max", width: 440, height: 956 },
      { name: "iPhone 16", width: 393, height: 852 },
      { name: "iPhone SE", width: 375, height: 667 },
      { name: "Android Large", width: 412, height: 915 },
      { name: "Android Small", width: 360, height: 800 },
    ],
  },
  {
    category: "Tablet",
    presets: [
      { name: 'iPad Pro 12.9"', width: 1024, height: 1366 },
      { name: 'iPad Pro 11"', width: 834, height: 1194 },
      { name: "iPad Mini", width: 744, height: 1133 },
      { name: "Surface Pro", width: 912, height: 1368 },
    ],
  },
  {
    category: "Desktop",
    presets: [
      { name: "Desktop", width: 1440, height: 900 },
      { name: 'MacBook Pro 16"', width: 1728, height: 1117 },
      { name: "MacBook Air", width: 1470, height: 956 },
      { name: "Desktop HD", width: 1920, height: 1080 },
    ],
  },
  {
    category: "TV",
    presets: [
      { name: "TV 1080p", width: 1920, height: 1080 },
      { name: "TV 4K", width: 3840, height: 2160 },
    ],
  },
];

function FramePresetsPanel() {
  const addNode = useSceneStore((s) => s.addNode);

  const handlePresetClick = (preset: { name: string; width: number; height: number }) => {
    const { scale, x, y } = useViewportStore.getState();
    // Estimate canvas area from DOM
    const canvasEl = document.querySelector("[data-canvas]");
    const canvasWidth = canvasEl?.clientWidth ?? window.innerWidth - 480;
    const canvasHeight = canvasEl?.clientHeight ?? window.innerHeight;

    // Viewport center in world coordinates
    const worldCenterX = (-x + canvasWidth / 2) / scale;
    const worldCenterY = (-y + canvasHeight / 2) / scale;

    const id = generateId();
    const node: FrameNode = {
      id,
      type: "frame",
      x: Math.round(worldCenterX - preset.width / 2),
      y: Math.round(worldCenterY - preset.height / 2),
      width: preset.width,
      height: preset.height,
      name: preset.name,
      fill: "#ffffff",
      stroke: "#cccccc",
      strokeWidth: 1,
      children: [],
    };

    addNode(node);
    useSelectionStore.getState().select(id);
    useDrawModeStore.getState().setActiveTool(null);
  };

  return (
    <div className="px-3 py-2">
      <div className="text-[11px] font-semibold text-text-primary mb-2">
        Frame Presets
      </div>
      {FRAME_PRESETS.map((group) => (
        <div key={group.category} className="mb-3">
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1 px-1">
            {group.category}
          </div>
          {group.presets.map((preset) => (
            <button
              key={`${preset.name}-${preset.width}x${preset.height}`}
              onClick={() => handlePresetClick(preset)}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded text-[11px] hover:bg-surface-hover transition-colors text-left"
            >
              <span className="text-text-primary truncate mr-2">{preset.name}</span>
              <span className="text-text-muted whitespace-nowrap">
                {preset.width} × {preset.height}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function PropertiesPanel() {
  const nodes = useSceneStore((s) => s.nodes);
  const updateNode = useSceneStore((s) => s.updateNode);
  const { selectedIds, instanceContext } = useSelectionStore();
  const variables = useVariableStore((s) => s.variables);
  const activeTheme = useThemeStore((s) => s.activeTheme);
  const activeTool = useDrawModeStore((s) => s.activeTool);
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
        {activeTool === "frame" && <FramePresetsPanel />}
        {selectedIds.length === 0 && activeTool !== "frame" && (
          <PageProperties />
        )}
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
