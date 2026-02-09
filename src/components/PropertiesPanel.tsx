import { useState, useMemo } from "react";
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
import { MultiSelectPropertyEditor } from "@/components/properties/MultiSelectPropertyEditor";
import { PageProperties } from "@/components/properties/PageProperties";
import { PropertyEditor } from "@/components/properties/PropertyEditor";
import { VariablesDialog } from "@/components/VariablesPanel";
import { SlidersHorizontal, CaretRightIcon } from "@phosphor-icons/react";
import clsx from "clsx";

// Chevron icon for expand/collapse
const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <CaretRightIcon
    size={12}
    className={clsx(
      "w-3 h-3 transition-transform duration-150",
      "text-text-muted",
      expanded && "rotate-90",
    )}
    weight="bold"
  />
);

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
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["Mobile"]), // Mobile expanded by default
  );

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handlePresetClick = (preset: {
    name: string;
    width: number;
    height: number;
  }) => {
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
    <div className="px-4 pt-3 pb-5 border-b border-border-default">
      <div className="text-[11px] font-semibold text-text-primary mb-2">
        Frame Presets
      </div>
      {FRAME_PRESETS.map((group) => {
        const isExpanded = expandedCategories.has(group.category);
        return (
          <div key={group.category} className="mb-2">
            <button
              onClick={() => toggleCategory(group.category)}
              className="w-full flex items-center gap-1 px-1 py-1 rounded hover:bg-surface-elevated text-left"
            >
              <ChevronIcon expanded={isExpanded} />
              <div className="text-[11px]">{group.category}</div>
            </button>
            {isExpanded && (
              <div className="mt-1">
                {group.presets.map((preset) => (
                  <button
                    key={`${preset.name}-${preset.width}x${preset.height}`}
                    onClick={() => handlePresetClick(preset)}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded text-[11px] hover:bg-surface-elevated text-left"
                  >
                    <span className="text-text-primary truncate mr-2">
                      {preset.name}
                    </span>
                    <span className="text-text-muted whitespace-nowrap">
                      {preset.width} × {preset.height}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function PropertiesPanel() {
  const nodes = useSceneStore((s) => s.getNodes());
  const updateNode = useSceneStore((s) => s.updateNode);
  const { selectedIds, instanceContext } = useSelectionStore();
  const variables = useVariableStore((s) => s.variables);
  const activeTheme = useThemeStore((s) => s.activeTheme);
  const activeTool = useDrawModeStore((s) => s.activeTool);
  const [variablesOpen, setVariablesOpen] = useState(false);

  const selectedNode =
    selectedIds.length === 1 ? findNodeById(nodes, selectedIds[0]) : null;

  const nodesById = useSceneStore((s) => s.nodesById);
  const selectedNodes = useMemo(() => {
    if (selectedIds.length <= 1) return [];
    return selectedIds
      .map((id) => nodesById[id])
      .filter(Boolean) as SceneNode[];
  }, [selectedIds, nodesById]);

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
        {(selectedIds.length > 1 || (selectedIds.length === 1 && parentContext.parent && !parentContext.isInsideAutoLayout)) && (
          <AlignmentSection
            count={selectedIds.length}
            selectedIds={selectedIds}
            nodes={nodes}
            parentFrame={parentContext.parent}
          />
        )}
        {/* Multi-select property editor */}
        {selectedNodes.length > 1 && activeTool !== "frame" && (
          <MultiSelectPropertyEditor
            selectedNodes={selectedNodes}
            variables={variables}
            activeTheme={activeTheme}
          />
        )}
        {/* If editing a descendant inside an instance, show descendant editor */}
        {instanceContext && activeTool !== "frame" && (
          <DescendantPropertyEditor
            instanceContext={instanceContext}
            allNodes={nodes}
            variables={variables}
            activeTheme={activeTheme}
          />
        )}
        {/* Otherwise show normal property editor */}
        {selectedNode && !instanceContext && activeTool !== "frame" && (
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
