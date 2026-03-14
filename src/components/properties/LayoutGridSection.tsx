import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { PlusIcon, MinusIcon, EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import type {
  FrameNode,
  SceneNode,
  LayoutGridConfig,
  LayoutGridType,
  LayoutGridAlignment,
} from "@/types/scene";
import { generateId } from "@/types/scene";
import {
  NumberInput,
  PropertyRow,
  PropertySection,
  SelectInput,
} from "@/components/ui/PropertyInputs";
import { CustomColorPicker } from "@/components/ui/ColorPicker";
import { Button } from "@/components/ui/button";

interface LayoutGridSectionProps {
  node: FrameNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  mixedKeys?: Set<string>;
}

function defaultGrid(): LayoutGridConfig {
  return {
    id: generateId(),
    type: "columns",
    visible: true,
    color: "#FF0000",
    opacity: 0.1,
    count: 5,
    gutter: 20,
    margin: 0,
    width: null,
    alignment: "stretch",
  };
}

function gridSummary(grid: LayoutGridConfig): string {
  switch (grid.type) {
    case "grid":
      return `Grid ${grid.size ?? 10}px`;
    case "columns": {
      const w = grid.alignment === "stretch" || grid.width == null ? "Auto" : `${grid.width}`;
      return `${grid.count ?? 5} columns (${w})`;
    }
    case "rows": {
      const w = grid.alignment === "stretch" || grid.width == null ? "Auto" : `${grid.width}`;
      return `${grid.count ?? 5} rows (${w})`;
    }
  }
}

function GridTypeIcon({ type }: { type: LayoutGridType }) {
  if (type === "grid") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="1" width="5" height="5" stroke="currentColor" strokeWidth="1" />
        <rect x="8" y="1" width="5" height="5" stroke="currentColor" strokeWidth="1" />
        <rect x="1" y="8" width="5" height="5" stroke="currentColor" strokeWidth="1" />
        <rect x="8" y="8" width="5" height="5" stroke="currentColor" strokeWidth="1" />
      </svg>
    );
  }
  if (type === "columns") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="1" width="3" height="12" stroke="currentColor" strokeWidth="1" />
        <rect x="5.5" y="1" width="3" height="12" stroke="currentColor" strokeWidth="1" />
        <rect x="10" y="1" width="3" height="12" stroke="currentColor" strokeWidth="1" />
      </svg>
    );
  }
  // rows
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="12" height="3" stroke="currentColor" strokeWidth="1" />
      <rect x="1" y="5.5" width="12" height="3" stroke="currentColor" strokeWidth="1" />
      <rect x="1" y="10" width="12" height="3" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function GridPopover({
  grid,
  onUpdate,
  anchorEl,
  onClose,
}: {
  grid: LayoutGridConfig;
  onUpdate: (updated: LayoutGridConfig) => void;
  anchorEl: HTMLElement;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const updatePosition = useCallback(() => {
    const rect = anchorEl.getBoundingClientRect();
    const popover = popoverRef.current;
    if (!popover) return;

    const popoverRect = popover.getBoundingClientRect();
    let left = rect.left - popoverRect.width - 8;
    let top = rect.top;

    if (left < 8) left = rect.right + 8;
    if (top + popoverRect.height > window.innerHeight - 8) {
      top = window.innerHeight - 8 - popoverRect.height;
    }

    setStyle({ position: "fixed", left, top, zIndex: 9999 });
  }, [anchorEl]);

  useEffect(() => {
    // Small delay to allow mount
    requestAnimationFrame(updatePosition);
  }, [updatePosition]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !anchorEl.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [anchorEl, onClose]);

  const update = (patch: Partial<LayoutGridConfig>) => {
    onUpdate({ ...grid, ...patch });
  };

  const isColumnsOrRows = grid.type === "columns" || grid.type === "rows";
  const isStretch = grid.alignment === "stretch" || grid.alignment === undefined;

  return createPortal(
    <div
      ref={popoverRef}
      style={style}
      className="bg-surface-panel border border-border-default rounded-lg shadow-xl p-3 w-56 flex flex-col gap-2"
    >
      <SelectInput
        label="Type"
        labelOutside
        value={grid.type}
        options={[
          { value: "grid", label: "Grid" },
          { value: "columns", label: "Columns" },
          { value: "rows", label: "Rows" },
        ]}
        onChange={(v) => update({ type: v as LayoutGridType })}
      />

      {grid.type === "grid" ? (
        <NumberInput
          label="Size"
          labelOutside
          value={grid.size ?? 10}
          onChange={(v) => update({ size: v })}
          min={1}
        />
      ) : (
        <NumberInput
          label="Count"
          labelOutside
          value={grid.count ?? 5}
          onChange={(v) => update({ count: v })}
          min={1}
        />
      )}

      <PropertyRow>
        <div className="flex-1 flex flex-col gap-1">
          <span className="text-[10px] font-normal text-text-muted">Color</span>
          <div className="flex items-center gap-1">
            <CustomColorPicker
              value={grid.color}
              onChange={(c) => update({ color: c })}
            />
            <span className="text-[10px] text-text-muted font-mono">{grid.color}</span>
          </div>
        </div>
        <NumberInput
          label="Opacity"
          labelOutside
          value={Math.round(grid.opacity * 100)}
          onChange={(v) => update({ opacity: Math.max(0, Math.min(100, v)) / 100 })}
          min={0}
          max={100}
        />
      </PropertyRow>

      {isColumnsOrRows && (
        <>
          <SelectInput
            label="Align"
            labelOutside
            value={grid.alignment ?? "stretch"}
            options={[
              { value: "stretch", label: "Stretch" },
              { value: "center", label: "Center" },
              { value: "min", label: grid.type === "columns" ? "Left" : "Top" },
              { value: "max", label: grid.type === "columns" ? "Right" : "Bottom" },
            ]}
            onChange={(v) => {
              const a = v as LayoutGridAlignment;
              const patch: Partial<LayoutGridConfig> = { alignment: a };
              if (a === "stretch") {
                patch.width = null;
              } else if (grid.width == null) {
                patch.width = 60;
              }
              update(patch);
            }}
          />

          {!isStretch && (
            <NumberInput
              label="Width"
              labelOutside
              value={grid.width ?? 60}
              onChange={(v) => update({ width: v })}
              min={1}
            />
          )}

          <PropertyRow>
            <NumberInput
              label="Margin"
              labelOutside
              value={grid.margin ?? 0}
              onChange={(v) => update({ margin: v })}
              min={0}
            />
            <NumberInput
              label="Gutter"
              labelOutside
              value={grid.gutter ?? 20}
              onChange={(v) => update({ gutter: v })}
              min={0}
            />
          </PropertyRow>
        </>
      )}
    </div>,
    document.body,
  );
}

export function LayoutGridSection({ node, onUpdate }: LayoutGridSectionProps) {
  const grids = node.layoutGrids ?? [];
  const [popoverState, setPopoverState] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const closePopover = useCallback(() => setPopoverState(null), []);

  const updateGrids = (updated: LayoutGridConfig[]) => {
    onUpdate({ layoutGrids: updated.length > 0 ? updated : undefined } as Partial<SceneNode>);
  };

  const addGrid = () => {
    updateGrids([...grids, defaultGrid()]);
  };

  const removeGrid = (id: string) => {
    updateGrids(grids.filter((g) => g.id !== id));
    if (popoverState?.id === id) setPopoverState(null);
  };

  const toggleVisibility = (id: string) => {
    updateGrids(grids.map((g) => (g.id === id ? { ...g, visible: !g.visible } : g)));
  };

  const updateGrid = (updated: LayoutGridConfig) => {
    updateGrids(grids.map((g) => (g.id === updated.id ? updated : g)));
  };

  return (
    <PropertySection
      title="Layout grid"
      action={
        <Button variant="ghost" size="icon-sm" onClick={addGrid}>
          <PlusIcon />
        </Button>
      }
    >
      {grids.map((grid) => (
        <div
          key={grid.id}
          className="flex items-center gap-1.5 h-7 group"
        >
          <button
            className="flex items-center gap-1.5 flex-1 min-w-0 rounded px-1 py-0.5 hover:bg-surface-hover text-left"
            onClick={(e) => {
              if (popoverState?.id === grid.id) {
                setPopoverState(null);
              } else {
                setPopoverState({ id: grid.id, anchor: e.currentTarget.parentElement! });
              }
            }}
          >
            <span className="text-text-muted shrink-0">
              <GridTypeIcon type={grid.type} />
            </span>
            <span className="text-[11px] text-text-primary truncate">
              {gridSummary(grid)}
            </span>
          </button>

          <button
            className="shrink-0 text-text-muted hover:text-text-primary p-0.5"
            onClick={(e) => { e.stopPropagation(); toggleVisibility(grid.id); }}
            title={grid.visible ? "Hide grid" : "Show grid"}
          >
            {grid.visible ? <EyeIcon size={14} /> : <EyeSlashIcon size={14} />}
          </button>

          <button
            className="shrink-0 text-text-muted hover:text-text-primary p-0.5"
            onClick={(e) => { e.stopPropagation(); removeGrid(grid.id); }}
            title="Remove grid"
          >
            <MinusIcon size={14} />
          </button>

          {popoverState?.id === grid.id && (
            <GridPopover
              grid={grid}
              onUpdate={updateGrid}
              anchorEl={popoverState.anchor}
              onClose={closePopover}
            />
          )}
        </div>
      ))}
    </PropertySection>
  );
}
