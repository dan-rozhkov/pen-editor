import { useMemo, useState } from "react";
import clsx from "clsx";
import { CaretRightIcon, XIcon } from "@phosphor-icons/react";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useStyleStore } from "@/store/styleStore";
import { useTextStyleStore } from "@/store/textStyleStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { createOverlayHelpers } from "@/pixi/selectionOverlay/helpers";
import { buildInspectData } from "@/lib/inspect/buildInspectData";
import { getEffectiveThemeForNode } from "@/utils/nodeThemeUtils";
import { formatShortcut } from "@/lib/commands/shortcutFormat";
import type { FlatSceneNode } from "@/types/scene";
import { ButtonGroup } from "@/components/ui/button-group";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { SelectWithOptions } from "@/components/ui/select";
import { BoxModelDiagram } from "./BoxModelDiagram";
import { InspectRow } from "./InspectRow";
import { CodeSection } from "./CodeSection";
import { DevExportAddButton, DevExportSection } from "./DevExportSection";

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

const modeToggleGroupClass =
  "h-6 rounded-md bg-secondary gap-px [&>[data-slot]]:rounded-[5px]! [&>[data-slot]]:border [&>[data-slot]~[data-slot]]:border-l";
const activeModeToggleClass =
  "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel";

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="border-b border-border-default">
      <div className="flex min-h-10 items-center px-3 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronIcon expanded={expanded} />
          <span className="text-xs font-medium text-text-primary">{title}</span>
        </button>
        {action}
      </div>
      {expanded && <div className="[&:not(:empty)]:pb-1">{children}</div>}
    </div>
  );
}

export function InspectPanel() {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const nodeId = selectedIds[0];
  // Narrow subscription — only re-renders when the inspected node itself
  // changes, not on every unrelated scene edit. `buildInspectData` still
  // needs the *full* nodesById map (children/name lookups for e.g. layout
  // sections), which is read non-reactively via `.getState()` inside the
  // memo below rather than subscribed to here.
  const node = useSceneStore((s) => (nodeId ? s.nodesById[nodeId] : undefined));
  const variables = useVariableStore((s) => s.variables);
  const fillStyles = useStyleStore((s) => s.fillStyles);
  const effectStyles = useStyleStore((s) => s.effectStyles);
  const textStyles = useTextStyleStore((s) => s.textStyles);
  const units = useDevModeStore((s) => s.units);
  const remBase = useDevModeStore((s) => s.remBase);
  const setUnits = useDevModeStore((s) => s.setUnits);
  const [mode, setMode] = useState<"list" | "code">("list");

  const data = useMemo(() => {
    if (!nodeId || !node) return null;
    const rect = resolveRect(nodeId, node);
    const effectiveTheme = getEffectiveThemeForNode(nodeId);
    const nodesById = useSceneStore.getState().nodesById;
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
      effectiveTheme,
    });
  }, [nodeId, node, variables, fillStyles, effectStyles, textStyles, units, remBase]);

  return (
    <div className="w-[300px] h-full flex flex-col bg-surface-panel border-l border-border-default overflow-hidden">
      <div className="flex h-[58.5px] items-center justify-between gap-2 px-3 py-3 border-b border-border-default">
        <ButtonGroup orientation="horizontal" className={modeToggleGroupClass}>
          <Button
            type="button"
            variant={mode === "code" ? "default" : "secondary"}
            size="sm"
            className={mode === "code" ? activeModeToggleClass : undefined}
            onClick={() => setMode("code")}
          >
            Code
          </Button>
          <Button
            type="button"
            variant={mode === "list" ? "default" : "secondary"}
            size="sm"
            className={mode === "list" ? activeModeToggleClass : undefined}
            onClick={() => setMode("list")}
          >
            List
          </Button>
        </ButtonGroup>
        <div className="flex items-center gap-1.5">
          <SelectWithOptions
            size="sm"
            value={units}
            onValueChange={(v) => v && setUnits(v as "px" | "rem")}
            options={UNIT_OPTIONS}
            className="w-16"
          />
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            tooltip="Exit dev mode"
            shortcut={formatShortcut(["shift", "D"])}
            data-testid="inspect-exit-dev-mode"
            onClick={() => useDevModeStore.getState().setActive(false)}
          >
            <XIcon size={14} weight="light" />
          </IconButton>
        </div>
      </div>

      {!data ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <span className="text-text-muted text-xs">Select a layer to inspect</span>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto">
            {mode === "code" ? (
              <CodeSection selectedIds={selectedIds} />
            ) : (
              <>
              <div className="px-3 py-2 border-b border-border-default">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-text-primary truncate">{data.header.name}</span>
                  <span className="text-xs capitalize text-text-muted">
                    {data.header.type}
                  </span>
                </div>
                {data.header.componentInfo && (
                  <div className="mt-1 text-xs font-mono text-text-muted truncate">
                    {data.header.componentInfo.componentId}
                  </div>
                )}
                {data.header.componentInfo?.propertyValues &&
                  Object.entries(data.header.componentInfo.propertyValues).map(([key, value]) => (
                    <div
                      key={key}
                      className="mt-1 text-xs font-mono text-text-muted truncate flex items-center justify-between gap-2"
                    >
                      <span>{key}</span>
                      <span>{String(value)}</span>
                    </div>
                  ))}
                {selectedIds.length > 1 && (
                  <div className="mt-1 text-xs text-text-muted">{selectedIds.length} selected</div>
                )}
              </div>

              <Section title="Layer properties">
                <BoxModelDiagram
                  box={data.box}
                  textMetrics={data.textMetrics}
                  units={units}
                  remBase={remBase}
                />
              </Section>

              {data.sections.map((section) => (
                <Section key={section.title} title={section.title}>
                  {section.rows.map((row, i) => (
                    <InspectRow key={`${row.label}-${i}`} row={row} />
                  ))}
                </Section>
              ))}
              </>
            )}

            {/* Last section in the scrollable content (dev-03): available in
                both List and Code modes, but never pinned to the panel edge.
                Only rendered for a single selection, matching Design mode's
                ExportSettingsSection. */}
            {selectedIds.length === 1 && (
              <Section
                title="Export"
                action={<DevExportAddButton nodeId={nodeId!} exportSettings={node?.exportSettings} />}
              >
                <DevExportSection
                  nodeId={nodeId!}
                  nodeName={node?.name}
                  exportSettings={node?.exportSettings}
                  hideBodyAddAction
                />
              </Section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
