import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useVariableStore } from "@/store/variableStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useViewportStore } from "@/store/viewportStore";
import type {
  FlatFrameNode,
  FlatGroupNode,
  FlatSceneNode,
  FrameNode,
  SceneNode,
} from "@/types/scene";
import { generateId } from "@/types/scene";
import {
  getParentContextFlat,
  getThemeFromAncestorFrames,
  type FlatParentContext,
} from "@/utils/nodeUtils";
import { BooleanOperationsSection } from "@/components/properties/BooleanOperationsSection";
import { DescendantPropertyEditor } from "@/components/properties/DescendantPropertyEditor";
import { MultiSelectPropertyEditor } from "@/components/properties/MultiSelectPropertyEditor";
import { PageProperties } from "@/components/properties/PageProperties";
import { PencilToolProperties } from "@/components/properties/PencilToolProperties";
import { PropertyEditor } from "@/components/properties/PropertyEditor";
import { SpacingSection } from "@/components/properties/AlignmentSection";
import { CaretRightIcon } from "@phosphor-icons/react";
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
              className="w-full flex items-center gap-1 px-1 py-1 rounded hover:bg-secondary text-left"
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
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded text-[11px] hover:bg-secondary text-left"
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

const EMPTY_NODES: FlatSceneNode[] = [];

export function PropertiesPanel() {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const instanceContext = useSelectionStore((s) => s.instanceContext);
  const updateNode = useSceneStore((s) => s.updateNode);
  const variables = useVariableStore((s) => s.variables);
  const activeTool = useDrawModeStore((s) => s.activeTool);

  const singleSelectedId = selectedIds.length === 1 ? selectedIds[0] : null;

  // Narrow subscriptions: the panel re-renders only when the selection or the
  // *selected node itself* changes — not on every scene mutation. Dragging
  // the selected node still updates the X/Y/size fields live.
  const selectedNode = useSceneStore((s): FlatSceneNode | null =>
    singleSelectedId ? (s.nodesById[singleSelectedId] ?? null) : null,
  );
  // Returns the parent node object itself (a stable reference from nodesById),
  // not a fresh context object — a selector that built `{ parent, ... }` inline
  // would return a new object on every store change and defeat the subscription.
  const parentNode = useSceneStore((s): FlatFrameNode | FlatGroupNode | null =>
    singleSelectedId
      ? getParentContextFlat(s.nodesById, s.parentById, singleSelectedId).parent
      : null,
  );
  const selectedNodes = useSceneStore(
    useShallow((s): FlatSceneNode[] =>
      selectedIds.length > 1
        ? (selectedIds
            .map((id) => s.nodesById[id])
            .filter(Boolean) as FlatSceneNode[])
        : EMPTY_NODES,
    ),
  );
  // The ancestor walk runs on each store change, but re-renders the panel only
  // when the resulting theme name (a string) actually changes.
  const effectiveTheme = useSceneStore((s) =>
    singleSelectedId
      ? getThemeFromAncestorFrames(s.parentById, s.nodesById, singleSelectedId, "light")
      : ("light" as const),
  );
  // DescendantPropertyEditor (instance-descendant editing) still needs the
  // full tree; this is a rare, non-performance-critical path (Task 6 will
  // migrate it off `allNodes`). Kept narrow: when there's no instanceContext
  // this returns a stable empty array, so it never triggers a re-render on
  // ordinary scene mutations.
  const descendantAllNodes = useSceneStore((s) =>
    instanceContext ? s.getNodes() : EMPTY_NODES,
  );

  const parentContext: FlatParentContext = useMemo(
    () => ({
      parent: parentNode,
      isInsideAutoLayout:
        parentNode?.type === "frame" && !!parentNode.layout?.autoLayout,
    }),
    [parentNode],
  );

  const handleUpdate = useCallback(
    (updates: Partial<SceneNode>) => {
      if (singleSelectedId) updateNode(singleSelectedId, updates);
    },
    [singleSelectedId, updateNode],
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden [&_[data-slot=button-group]_[data-slot=button]:focus-visible]:border-transparent [&_[data-slot=button-group]_[data-slot=button]:focus-visible]:ring-0 [&_[data-slot=button-group]_[data-slot=button]:focus-visible]:outline-none">
      <div className="layers-scrollbar flex-1 overflow-y-auto">
        {activeTool === "pencil" && selectedIds.length === 0 && <PencilToolProperties />}
        {activeTool === "frame" && <FramePresetsPanel />}
        {selectedIds.length === 0 && activeTool !== "frame" && activeTool !== "pencil" && (
          <PageProperties />
        )}
        {selectedNodes.length > 1 && activeTool !== "frame" && (
          <BooleanOperationsSection
            selectedIds={selectedIds}
            selectedNodes={selectedNodes as SceneNode[]}
          />
        )}
        {selectedNodes.length > 1 && activeTool !== "frame" && (
          <SpacingSection selectedIds={selectedIds} />
        )}
        {/* Multi-select property editor */}
        {selectedNodes.length > 1 && activeTool !== "frame" && (
          <MultiSelectPropertyEditor
            selectedNodes={selectedNodes as SceneNode[]}
            variables={variables}
            activeTheme={effectiveTheme}
          />
        )}
        {instanceContext && activeTool !== "frame" && (
          <DescendantPropertyEditor
            instanceContext={instanceContext}
            allNodes={descendantAllNodes as unknown as SceneNode[]}
            variables={variables}
            activeTheme={effectiveTheme}
          />
        )}
        {/* Show normal property editor */}
        {selectedNode && !instanceContext && activeTool !== "frame" && (
          <PropertyEditor
            // Flat node: sections must not rely on `node.children` (subtree
            // access goes through nodesById/childrenById + materializeLayoutRefs).
            node={selectedNode as SceneNode}
            onUpdate={handleUpdate}
            parentContext={parentContext}
            variables={variables}
            activeTheme={effectiveTheme}
          />
        )}
      </div>
    </div>
  );
}
