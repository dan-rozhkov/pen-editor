import { useMemo, useState } from "react";
import clsx from "clsx";
import { CaretRightIcon } from "@phosphor-icons/react";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useStyleStore } from "@/store/styleStore";
import { useTextStyleStore } from "@/store/textStyleStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { createOverlayHelpers } from "@/pixi/selectionOverlay/helpers";
import { buildInspectData } from "@/lib/inspect/buildInspectData";
import type { FlatSceneNode } from "@/types/scene";
import { ButtonGroup } from "@/components/ui/button-group";
import { Button } from "@/components/ui/button";
import { SelectWithOptions } from "@/components/ui/select";
import { BoxModelDiagram } from "./BoxModelDiagram";
import { InspectRow } from "./InspectRow";

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <CaretRightIcon
    size={12}
    className={clsx("w-3 h-3 transition-transform duration-150", "text-text-muted", expanded && "rotate-90")}
    weight="bold"
  />
);

/**
 * Best-effort absolute draw rect for a node. Prefers the live Pixi-rendered
 * rect (accounts for layout, auto-layout, instance overrides, etc.) via the
 * selection-overlay helpers; falls back to the node's own width/height when
 * no Pixi scene root is mounted (e.g. unit tests) or the node isn't drawn.
 */
function resolveRect(nodeId: string, node: FlatSceneNode): { x: number; y: number; width: number; height: number } {
  const sceneRoot = useCanvasRefStore.getState().pixiRefs?.sceneRoot;
  if (sceneRoot) {
    try {
      const helpers = createOverlayHelpers(sceneRoot);
      const rect = helpers.getNodeDrawRect(nodeId);
      if (rect) return rect;
    } catch {
      // Fall through to the static fallback below.
    }
  }
  return { x: node.x ?? 0, y: node.y ?? 0, width: node.width, height: node.height };
}

const UNIT_OPTIONS = [
  { value: "px", label: "px" },
  { value: "rem", label: "rem" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="border-b border-border-default">
      <button
        type="button"
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-surface-hover"
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronIcon expanded={expanded} />
        <span className="text-xs font-medium text-text-primary">{title}</span>
      </button>
      {expanded && <div className="pb-1">{children}</div>}
    </div>
  );
}

export function InspectPanel() {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const nodesById = useSceneStore((s) => s.nodesById);
  const variables = useVariableStore((s) => s.variables);
  const fillStyles = useStyleStore((s) => s.fillStyles);
  const effectStyles = useStyleStore((s) => s.effectStyles);
  const textStyles = useTextStyleStore((s) => s.textStyles);
  const units = useDevModeStore((s) => s.units);
  const remBase = useDevModeStore((s) => s.remBase);
  const setUnits = useDevModeStore((s) => s.setUnits);
  const [mode, setMode] = useState<"list" | "code">("list");

  const nodeId = selectedIds[0];
  const node = nodeId ? nodesById[nodeId] : undefined;

  const data = useMemo(() => {
    if (!nodeId || !node) return null;
    const rect = resolveRect(nodeId, node);
    return buildInspectData({
      nodeId,
      nodesById,
      rect,
      variables,
      fillStyles,
      effectStyles,
      textStyles,
      units,
      remBase,
    });
  }, [nodeId, node, nodesById, variables, fillStyles, effectStyles, textStyles, units, remBase]);

  return (
    <div className="w-[300px] h-full flex flex-col bg-surface-panel border-l border-border-default overflow-y-auto">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border-default">
        <ButtonGroup>
          <Button
            type="button"
            variant={mode === "code" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("code")}
          >
            Code
          </Button>
          <Button
            type="button"
            variant={mode === "list" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("list")}
          >
            List
          </Button>
        </ButtonGroup>
        <SelectWithOptions
          size="sm"
          value={units}
          onValueChange={(v) => v && setUnits(v as "px" | "rem")}
          options={UNIT_OPTIONS}
          className="w-16"
        />
      </div>

      {!data ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <span className="text-text-muted text-xs">Select a layer to inspect</span>
        </div>
      ) : mode === "code" ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <span className="text-text-muted text-xs">Code generation coming soon</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2 border-b border-border-default border-l-2 border-l-green-500">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-text-primary truncate">{data.header.name}</span>
              <span className="text-[10px] uppercase tracking-wide text-green-500 bg-green-500/20 rounded px-1.5 py-0.5 shrink-0">
                {data.header.type}
              </span>
            </div>
            {data.header.componentInfo && (
              <div className="mt-1 text-xs font-mono text-text-muted truncate">
                {data.header.componentInfo.componentId}
              </div>
            )}
            {selectedIds.length > 1 && (
              <div className="mt-1 text-xs text-text-muted">{selectedIds.length} selected</div>
            )}
          </div>

          <BoxModelDiagram box={data.box} units={units} remBase={remBase} />

          {data.sections.map((section) => (
            <Section key={section.title} title={section.title}>
              {section.rows.map((row, i) => (
                <InspectRow key={`${row.label}-${i}`} row={row} />
              ))}
            </Section>
          ))}
        </div>
      )}
    </div>
  );
}
