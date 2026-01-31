import { useState, useRef } from "react";
import {
  TextAlignLeft,
  TextAlignCenter,
  TextAlignRight,
  AlignTop,
  AlignCenterVertical,
  AlignBottom,
  TextUnderline,
  TextStrikethrough,
  TextItalic,
  ArrowsOut,
  ArrowRight,
  Article,
  DiamondsFour,
  ArrowClockwise,
} from "@phosphor-icons/react";
import { useSceneStore } from "../store/sceneStore";
import { useHistoryStore } from "../store/historyStore";
import {
  useSelectionStore,
  type InstanceContext,
} from "../store/selectionStore";
import { useVariableStore } from "../store/variableStore";
import { useThemeStore } from "../store/themeStore";
import { useCanvasRefStore } from "../store/canvasRefStore";
import {
  exportImage,
  type ExportFormat,
  type ExportScale,
} from "../utils/exportUtils";
import type {
  SceneNode,
  FrameNode,
  RefNode,
  FlexDirection,
  AlignItems,
  JustifyContent,
  SizingMode,
  TextNode,
  DescendantOverride,
  ImageFillMode,
} from "../types/scene";
import type { ThemeName, Variable } from "../types/variable";
import {
  findParentFrame,
  findNodeById,
  findComponentById,
  type ParentContext,
} from "../utils/nodeUtils";
import {
  alignNodes,
  calculateSpacing,
  distributeSpacing,
  type AlignmentType,
} from "../utils/alignmentUtils";
import {
  PropertySection,
  PropertyRow,
  NumberInput,
  ColorInput,
  SelectInput,
  CheckboxInput,
  FlipControls,
} from "./ui/PropertyInputs";
import { SelectWithOptions } from "./ui/select";
import { FontCombobox } from "./ui/FontCombobox";
import { Input } from "./ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";

// Helper to find a node within a component's children tree
function findNodeInComponent(
  children: SceneNode[],
  nodeId: string,
): SceneNode | null {
  for (const child of children) {
    if (child.id === nodeId) return child;
    if (child.type === "frame" || child.type === "group") {
      const found = findNodeInComponent((child as any).children, nodeId);
      if (found) return found;
    }
  }
  return null;
}

function PageProperties() {
  const pageBackground = useSceneStore((s) => s.pageBackground);
  const setPageBackground = useSceneStore((s) => s.setPageBackground);

  return (
    <div>
      <div className="text-text-secondary text-xs font-medium mb-2">Page</div>
      <PropertySection title="Background">
        <ColorInput value={pageBackground} onChange={setPageBackground} />
      </PropertySection>
    </div>
  );
}

interface AlignmentSectionProps {
  count: number;
  selectedIds: string[];
  nodes: SceneNode[];
}

function AlignmentSection({
  count,
  selectedIds,
  nodes,
}: AlignmentSectionProps) {
  const handleAlign = (alignment: AlignmentType) => {
    const updates = alignNodes(selectedIds, nodes, alignment);
    if (updates.length === 0) return;

    // Save history before batch update
    useHistoryStore.getState().saveHistory(nodes);

    // Apply all updates at once
    let newNodes = nodes;
    for (const update of updates) {
      const { id, ...changes } = update;
      if (Object.keys(changes).length > 0) {
        newNodes = applyUpdateRecursive(newNodes, id, changes);
      }
    }
    useSceneStore.getState().setNodesWithoutHistory(newNodes);
  };

  // Helper to apply update recursively in the tree
  function applyUpdateRecursive(
    nodeList: SceneNode[],
    id: string,
    changes: Partial<SceneNode>,
  ): SceneNode[] {
    return nodeList.map((node) => {
      if (node.id === id) {
        return { ...node, ...changes } as SceneNode;
      }
      if (node.type === "frame" || node.type === "group") {
        return {
          ...node,
          children: applyUpdateRecursive(
            (node as FrameNode).children,
            id,
            changes,
          ),
        } as FrameNode;
      }
      return node;
    });
  }

  const iconSize = 16;
  const buttonBaseClass = "p-2 rounded transition-colors";
  const buttonClass = `${buttonBaseClass} bg-surface-elevated hover:bg-surface-hover text-text-muted hover:text-text-primary`;

  return (
    <div className="flex flex-col gap-4">
      <PropertySection title="Alignment">
        <div className="flex gap-1">
          <button
            className={buttonClass}
            onClick={() => handleAlign("left")}
            title="Align left"
          >
            <TextAlignLeft size={iconSize} />
          </button>
          <button
            className={buttonClass}
            onClick={() => handleAlign("centerH")}
            title="Align center horizontally"
          >
            <TextAlignCenter size={iconSize} />
          </button>
          <button
            className={buttonClass}
            onClick={() => handleAlign("right")}
            title="Align right"
          >
            <TextAlignRight size={iconSize} />
          </button>
          <div className="w-2" />
          <button
            className={buttonClass}
            onClick={() => handleAlign("top")}
            title="Align top"
          >
            <AlignTop size={iconSize} />
          </button>
          <button
            className={buttonClass}
            onClick={() => handleAlign("centerV")}
            title="Align center vertically"
          >
            <AlignCenterVertical size={iconSize} />
          </button>
          <button
            className={buttonClass}
            onClick={() => handleAlign("bottom")}
            title="Align bottom"
          >
            <AlignBottom size={iconSize} />
          </button>
        </div>
      </PropertySection>
      <SpacingInput
        selectedIds={selectedIds}
        nodes={nodes}
        applyUpdateRecursive={applyUpdateRecursive}
      />
      <div className="text-text-muted text-xs text-center">
        {count} layers selected
      </div>
    </div>
  );
}

function SpacingInput({
  selectedIds,
  nodes,
  applyUpdateRecursive,
}: {
  selectedIds: string[];
  nodes: SceneNode[];
  applyUpdateRecursive: (
    nodeList: SceneNode[],
    id: string,
    changes: Partial<SceneNode>,
  ) => SceneNode[];
}) {
  const spacing = calculateSpacing(selectedIds, nodes);
  const [localValue, setLocalValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  if (spacing === null) return null;

  const displayValue = isFocused
    ? localValue
    : spacing === "mixed"
    ? ""
    : String(Math.round(spacing));
  const placeholder = spacing === "mixed" ? "mixed" : undefined;

  const handleApply = (inputValue: string) => {
    const val = parseFloat(inputValue);
    if (isNaN(val)) return;

    const updates = distributeSpacing(selectedIds, nodes, val);
    if (updates.length === 0) return;

    useHistoryStore.getState().saveHistory(nodes);
    let newNodes = nodes;
    for (const update of updates) {
      const { id, ...changes } = update;
      if (Object.keys(changes).length > 0) {
        newNodes = applyUpdateRecursive(newNodes, id, changes);
      }
    }
    useSceneStore.getState().setNodesWithoutHistory(newNodes);
  };

  return (
    <PropertySection title="Spacing">
      <div className="flex-1">
        <Input
          type="text"
          inputMode="numeric"
          value={displayValue}
          placeholder={placeholder}
          onChange={(e) => setLocalValue(e.target.value)}
          onFocus={() => {
            setIsFocused(true);
            setLocalValue(
              spacing === "mixed" ? "" : String(Math.round(spacing as number)),
            );
          }}
          onBlur={(e) => {
            setIsFocused(false);
            handleApply(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleApply((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>
    </PropertySection>
  );
}

// Override indicator for instance properties
function OverrideIndicator({
  isOverridden,
  onReset,
}: {
  isOverridden: boolean;
  onReset: () => void;
}) {
  if (!isOverridden) return null;
  return (
    <button
      onClick={onReset}
      className="ml-1 p-0.5 text-purple-400 hover:text-purple-300 flex-shrink-0"
      title="Reset to component value"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path
          d="M2 6a4 4 0 107.5-2M9.5 1v3h-3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

// Image Fill section for rect, ellipse, frame
function ImageFillSection({
  imageFill,
  onUpdate,
}: {
  imageFill?: { url: string; mode: ImageFillMode } | undefined;
  onUpdate: (updates: Partial<SceneNode>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      onUpdate({
        imageFill: { url: dataUrl, mode: imageFill?.mode ?? "fill" },
      } as Partial<SceneNode>);
    };
    reader.readAsDataURL(file);
    // Reset so same file can be re-selected
    e.target.value = "";
  };

  const handleRemove = () => {
    onUpdate({ imageFill: undefined } as Partial<SceneNode>);
  };

  const handleModeChange = (mode: string) => {
    if (!imageFill) return;
    onUpdate({
      imageFill: { ...imageFill, mode: mode as ImageFillMode },
    } as Partial<SceneNode>);
  };

  return (
    <PropertySection title="Image Fill">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      {imageFill ? (
        <div className="flex flex-col gap-2">
          {/* Preview */}
          <div className="w-full h-20 rounded border border-border-light overflow-hidden bg-surface-elevated">
            <img
              src={imageFill.url}
              alt="Fill preview"
              className="w-full h-full object-cover"
            />
          </div>

          {/* Scale mode */}
          <SelectInput
            label="Mode"
            value={imageFill.mode}
            options={[
              { value: "fill", label: "Fill (Cover)" },
              { value: "fit", label: "Fit (Contain)" },
              { value: "stretch", label: "Stretch" },
            ]}
            onChange={handleModeChange}
          />

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-text-secondary text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
            >
              Replace
            </button>
            <button
              onClick={handleRemove}
              className="flex-1 px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-red-400 text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => fileInputRef.current?.click()}
          variant="secondary"
          className="w-full"
        >
          Upload Image
        </Button>
      )}
    </PropertySection>
  );
}

interface PropertyEditorProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  parentContext: ParentContext;
  variables: Variable[];
  activeTheme: ThemeName;
  allNodes: SceneNode[];
}

const sizingOptions = [
  { value: "fixed", label: "Fixed" },
  { value: "fill_container", label: "Fill" },
  { value: "fit_content", label: "Fit" },
];

function PropertyEditor({
  node,
  onUpdate,
  parentContext,
  variables,
  activeTheme,
  allNodes,
}: PropertyEditorProps) {
  // Get component if this is an instance (RefNode)
  const component =
    node.type === "ref"
      ? findComponentById(allNodes, (node as RefNode).componentId)
      : null;

  // Check if a property is overridden (defined on instance and different from component)
  const isOverridden = <T,>(
    instanceVal: T | undefined,
    componentVal: T | undefined,
  ): boolean => {
    if (!component) return false;
    return instanceVal !== undefined && instanceVal !== componentVal;
  };

  // Reset an override by setting property to undefined
  const resetOverride = (property: keyof SceneNode) => {
    onUpdate({ [property]: undefined } as Partial<SceneNode>);
  };

  // Handler for fill variable binding
  const handleFillVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      onUpdate({ fillBinding: { variableId } });
    } else {
      onUpdate({ fillBinding: undefined });
    }
  };

  // Handler for stroke variable binding
  const handleStrokeVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      onUpdate({ strokeBinding: { variableId } });
    } else {
      onUpdate({ strokeBinding: undefined });
    }
  };

  // Filter only color variables
  const colorVariables = variables.filter((v) => v.type === "color");

  return (
    <div className="flex flex-col">
      {/* Type Section */}
      <PropertySection title="Type">
        <div className="flex items-center gap-2">
          {node.type === "group" ||
          (node.type === "frame" && !(node as FrameNode).reusable) ? (
            <>
              <div className="flex-1">
                <SelectInput
                  value={node.type}
                  options={[
                    { value: "frame", label: "Frame" },
                    { value: "group", label: "Group" },
                  ]}
                  onChange={(v) => {
                    if (v !== node.type) {
                      useSceneStore.getState().convertNodeType(node.id);
                    }
                  }}
                />
              </div>
              {node.type === "frame" && !(node as FrameNode).reusable && (
                <button
                  className="p-1 rounded hover:bg-surface-elevated text-text-muted transition-colors"
                  onClick={() =>
                    onUpdate({ reusable: true } as Partial<SceneNode>)
                  }
                  title="Create Component"
                >
                  <DiamondsFour size={16} />
                </button>
              )}
            </>
          ) : (
            <div className="text-xs text-text-secondary capitalize">
              {node.type}
            </div>
          )}
        </div>
      </PropertySection>

      {/* Position Section */}
      <PropertySection title="Position">
        <PropertyRow>
          <NumberInput
            label="X"
            value={node.x}
            onChange={(v) => onUpdate({ x: v })}
          />
          <NumberInput
            label="Y"
            value={node.y}
            onChange={(v) => onUpdate({ y: v })}
          />
        </PropertyRow>
        <div className="flex gap-2 mt-2">
          <div className="w-1/2">
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <ArrowClockwise size={14} />
              </InputGroupAddon>
              <InputGroupInput
                type="number"
                value={Math.round((node.rotation ?? 0) * 100) / 100}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    onUpdate({ rotation: val });
                  }
                }}
                min={0}
                max={360}
                step={1}
              />
            </InputGroup>
          </div>
          <div className="w-1/2">
            <FlipControls
              flipX={node.flipX ?? false}
              flipY={node.flipY ?? false}
              onFlipXChange={(value) => onUpdate({ flipX: value })}
              onFlipYChange={(value) => onUpdate({ flipY: value })}
            />
          </div>
        </div>
      </PropertySection>

      {/* Size Section */}
      <PropertySection title="Size">
        {/* Show sizing mode controls when inside auto-layout OR when frame has auto-layout enabled */}
        {(parentContext.isInsideAutoLayout ||
          (node.type === "frame" &&
            (node as FrameNode).layout?.autoLayout)) && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-text-muted w-4 shrink-0">
                W
              </span>
              <ButtonGroup orientation="horizontal" className="flex-1">
                {sizingOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant={
                      (node.sizing?.widthMode ?? "fixed") === option.value
                        ? "default"
                        : "secondary"
                    }
                    size="sm"
                    className={`flex-1 ${
                      (node.sizing?.widthMode ?? "fixed") === option.value
                        ? "bg-accent-selection hover:bg-accent-selection/80 text-accent-foreground"
                        : ""
                    }`}
                    onClick={() =>
                      onUpdate({
                        sizing: {
                          ...node.sizing,
                          widthMode: option.value as SizingMode,
                        },
                      })
                    }
                  >
                    {option.label}
                  </Button>
                ))}
              </ButtonGroup>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-text-muted w-4 shrink-0">
                H
              </span>
              <ButtonGroup orientation="horizontal" className="flex-1">
                {sizingOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant={
                      (node.sizing?.heightMode ?? "fixed") === option.value
                        ? "default"
                        : "secondary"
                    }
                    size="sm"
                    className={`flex-1 ${
                      (node.sizing?.heightMode ?? "fixed") === option.value
                        ? "bg-accent-selection hover:bg-accent-selection/80 text-accent-foreground"
                        : ""
                    }`}
                    onClick={() =>
                      onUpdate({
                        sizing: {
                          ...node.sizing,
                          heightMode: option.value as SizingMode,
                        },
                      })
                    }
                  >
                    {option.label}
                  </Button>
                ))}
              </ButtonGroup>
            </div>
          </>
        )}
        <PropertyRow>
          <NumberInput
            label="W"
            value={node.width}
            onChange={(v) => onUpdate({ width: v })}
            min={1}
          />
          <NumberInput
            label="H"
            value={node.height}
            onChange={(v) => onUpdate({ height: v })}
            min={1}
          />
        </PropertyRow>
      </PropertySection>

      {/* Appearance Section */}
      <PropertySection title="Appearance">
        <PropertyRow>
          <NumberInput
            label="Opacity %"
            value={Math.round((node.opacity ?? 1) * 100)}
            onChange={(v) =>
              onUpdate({ opacity: Math.max(0, Math.min(100, v)) / 100 })
            }
            min={0}
            max={100}
            step={1}
            labelOutside={true}
          />
          {(node.type === "frame" || node.type === "rect") && (
            <NumberInput
              label="Radius"
              value={node.cornerRadius ?? 0}
              onChange={(v) => onUpdate({ cornerRadius: v })}
              min={0}
              labelOutside={true}
            />
          )}
        </PropertyRow>
      </PropertySection>

      {/* Fill Section */}
      <PropertySection title="Fill">
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <ColorInput
              value={node.fill ?? component?.fill ?? "#000000"}
              onChange={(v) => onUpdate({ fill: v })}
              variableId={node.fillBinding?.variableId}
              onVariableChange={handleFillVariableChange}
              availableVariables={colorVariables}
              activeTheme={activeTheme}
            />
          </div>
          <OverrideIndicator
            isOverridden={isOverridden(node.fill, component?.fill)}
            onReset={() => resetOverride("fill")}
          />
        </div>
      </PropertySection>

      {/* Image Fill Section (for rect, ellipse, frame) */}
      {(node.type === "rect" ||
        node.type === "ellipse" ||
        node.type === "frame") && (
        <ImageFillSection imageFill={node.imageFill} onUpdate={onUpdate} />
      )}

      {/* Stroke Section */}
      <PropertySection title="Stroke">
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <ColorInput
              value={node.stroke ?? component?.stroke ?? ""}
              onChange={(v) => onUpdate({ stroke: v || undefined })}
              variableId={node.strokeBinding?.variableId}
              onVariableChange={handleStrokeVariableChange}
              availableVariables={colorVariables}
              activeTheme={activeTheme}
            />
          </div>
          <OverrideIndicator
            isOverridden={isOverridden(node.stroke, component?.stroke)}
            onReset={() => resetOverride("stroke")}
          />
        </div>
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <NumberInput
              label="Weight"
              labelOutside={true}
              value={node.strokeWidth ?? component?.strokeWidth ?? 0}
              onChange={(v) => onUpdate({ strokeWidth: v })}
              min={0}
              step={0.5}
            />
          </div>
          <OverrideIndicator
            isOverridden={isOverridden(
              node.strokeWidth,
              component?.strokeWidth,
            )}
            onReset={() => resetOverride("strokeWidth")}
          />
        </div>
      </PropertySection>

      {/* Auto Layout (Frame only) */}
      {node.type === "frame" && (
        <PropertySection title="Auto Layout">
          <CheckboxInput
            label="Enable Auto Layout"
            checked={(node as FrameNode).layout?.autoLayout ?? false}
            onChange={(v) => {
              const updates: Partial<SceneNode> = {
                layout: { ...(node as FrameNode).layout, autoLayout: v },
              };
              // When enabling auto-layout, set heightMode to fit_content (like Figma)
              if (v) {
                updates.sizing = {
                  ...(node as FrameNode).sizing,
                  heightMode: "fit_content",
                };
              }
              onUpdate(updates);
            }}
          />
          {(node as FrameNode).layout?.autoLayout && (
            <>
              <SelectInput
                label="Direction"
                value={(node as FrameNode).layout?.flexDirection ?? "row"}
                options={[
                  { value: "row", label: "Horizontal" },
                  { value: "column", label: "Vertical" },
                ]}
                onChange={(v) =>
                  onUpdate({
                    layout: {
                      ...(node as FrameNode).layout,
                      flexDirection: v as FlexDirection,
                    },
                  } as Partial<SceneNode>)
                }
              />
              <NumberInput
                label="Gap"
                value={(node as FrameNode).layout?.gap ?? 0}
                onChange={(v) =>
                  onUpdate({
                    layout: { ...(node as FrameNode).layout, gap: v },
                  } as Partial<SceneNode>)
                }
                min={0}
              />
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mt-2">
                Padding
              </div>
              <PropertyRow>
                <NumberInput
                  label="T"
                  value={(node as FrameNode).layout?.paddingTop ?? 0}
                  onChange={(v) =>
                    onUpdate({
                      layout: { ...(node as FrameNode).layout, paddingTop: v },
                    } as Partial<SceneNode>)
                  }
                  min={0}
                />
                <NumberInput
                  label="R"
                  value={(node as FrameNode).layout?.paddingRight ?? 0}
                  onChange={(v) =>
                    onUpdate({
                      layout: {
                        ...(node as FrameNode).layout,
                        paddingRight: v,
                      },
                    } as Partial<SceneNode>)
                  }
                  min={0}
                />
              </PropertyRow>
              <PropertyRow>
                <NumberInput
                  label="B"
                  value={(node as FrameNode).layout?.paddingBottom ?? 0}
                  onChange={(v) =>
                    onUpdate({
                      layout: {
                        ...(node as FrameNode).layout,
                        paddingBottom: v,
                      },
                    } as Partial<SceneNode>)
                  }
                  min={0}
                />
                <NumberInput
                  label="L"
                  value={(node as FrameNode).layout?.paddingLeft ?? 0}
                  onChange={(v) =>
                    onUpdate({
                      layout: { ...(node as FrameNode).layout, paddingLeft: v },
                    } as Partial<SceneNode>)
                  }
                  min={0}
                />
              </PropertyRow>
              <SelectInput
                label="Align"
                value={(node as FrameNode).layout?.alignItems ?? "flex-start"}
                options={[
                  { value: "flex-start", label: "Start" },
                  { value: "center", label: "Center" },
                  { value: "flex-end", label: "End" },
                  { value: "stretch", label: "Stretch" },
                ]}
                onChange={(v) =>
                  onUpdate({
                    layout: {
                      ...(node as FrameNode).layout,
                      alignItems: v as AlignItems,
                    },
                  } as Partial<SceneNode>)
                }
              />
              <SelectInput
                label="Justify"
                value={
                  (node as FrameNode).layout?.justifyContent ?? "flex-start"
                }
                options={[
                  { value: "flex-start", label: "Start" },
                  { value: "center", label: "Center" },
                  { value: "flex-end", label: "End" },
                  { value: "space-between", label: "Space Between" },
                ]}
                onChange={(v) =>
                  onUpdate({
                    layout: {
                      ...(node as FrameNode).layout,
                      justifyContent: v as JustifyContent,
                    },
                  } as Partial<SceneNode>)
                }
              />
            </>
          )}
        </PropertySection>
      )}

      {/* Theme Override (Frame only) */}
      {node.type === "frame" && (
        <PropertySection title="Theme Override">
          <SelectInput
            label="Theme"
            value={(node as FrameNode).themeOverride ?? "inherit"}
            options={[
              { value: "inherit", label: "Inherit" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={(v) =>
              onUpdate({
                themeOverride: v === "inherit" ? undefined : (v as ThemeName),
              } as Partial<SceneNode>)
            }
          />
        </PropertySection>
      )}

      {/* Instance info (RefNode only) */}
      {node.type === "ref" &&
        (() => {
          const refNode = node as RefNode;
          const comp = findComponentById(allNodes, refNode.componentId);

          // Collect overridden properties
          const overrides: string[] = [];
          if (isOverridden(node.fill, comp?.fill)) overrides.push("Fill");
          if (isOverridden(node.stroke, comp?.stroke)) overrides.push("Stroke");
          if (isOverridden(node.strokeWidth, comp?.strokeWidth))
            overrides.push("Stroke Width");
          if (isOverridden(node.fillBinding, comp?.fillBinding))
            overrides.push("Fill Variable");
          if (isOverridden(node.strokeBinding, comp?.strokeBinding))
            overrides.push("Stroke Variable");

          return (
            <PropertySection title="Instance">
              <div className="flex items-center gap-2 text-xs text-purple-400">
                <svg viewBox="0 0 16 16" className="w-4 h-4">
                  <path
                    d="M8 2 L14 8 L8 14 L2 8 Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
                <span>Instance of: {comp?.name || "Component"}</span>
              </div>
              {overrides.length > 0 && (
                <div className="mt-2 flex flex-col gap-2">
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">
                    Overrides ({overrides.length})
                  </div>
                  <div className="text-xs text-text-secondary">
                    {overrides.join(", ")}
                  </div>
                  <button
                    onClick={() => {
                      onUpdate({
                        fill: undefined,
                        stroke: undefined,
                        strokeWidth: undefined,
                        fillBinding: undefined,
                        strokeBinding: undefined,
                      });
                    }}
                    className="px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-text-secondary text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
                  >
                    Reset All Overrides
                  </button>
                </div>
              )}
            </PropertySection>
          );
        })()}

      {/* Text Properties (Text only) */}
      {node.type === "text" && (
        <>
          <PropertySection title="Typography">
            <FontCombobox
              value={node.fontFamily ?? "Arial"}
              onChange={(v) =>
                onUpdate({ fontFamily: v } as Partial<SceneNode>)
              }
            />
            <PropertyRow>
              <NumberInput
                value={node.fontSize ?? 16}
                onChange={(v) =>
                  onUpdate({ fontSize: v } as Partial<SceneNode>)
                }
                min={1}
              />
              <SelectInput
                value={(node as TextNode).fontWeight ?? "normal"}
                options={[
                  { value: "normal", label: "Normal" },
                  { value: "100", label: "100 Thin" },
                  { value: "200", label: "200 Extra Light" },
                  { value: "300", label: "300 Light" },
                  { value: "400", label: "400 Regular" },
                  { value: "500", label: "500 Medium" },
                  { value: "600", label: "600 Semi Bold" },
                  { value: "700", label: "700 Bold" },
                  { value: "800", label: "800 Extra Bold" },
                  { value: "900", label: "900 Black" },
                ]}
                onChange={(v) =>
                  onUpdate({ fontWeight: v } as Partial<SceneNode>)
                }
              />
            </PropertyRow>
            <PropertyRow>
              <div className="flex items-center gap-1 flex-1">
                <Button
                  variant={
                    (node as TextNode).fontStyle === "italic"
                      ? "default"
                      : "secondary"
                  }
                  size="sm"
                  className={`flex-1 ${
                    (node as TextNode).fontStyle === "italic"
                      ? "bg-accent-selection hover:bg-accent-selection/80 text-accent-foreground"
                      : ""
                  }`}
                  onClick={() =>
                    onUpdate({
                      fontStyle:
                        (node as TextNode).fontStyle === "italic"
                          ? "normal"
                          : "italic",
                    } as Partial<SceneNode>)
                  }
                >
                  <TextItalic size={14} />
                </Button>
              </div>
              <div className="flex items-center gap-1 flex-1">
                <ButtonGroup orientation="horizontal" className="flex-1">
                  <Button
                    variant={
                      (node as TextNode).underline ? "default" : "secondary"
                    }
                    size="sm"
                    className={`flex-1 ${
                      (node as TextNode).underline
                        ? "bg-accent-selection hover:bg-accent-selection/80 text-accent-foreground"
                        : ""
                    }`}
                    onClick={() =>
                      onUpdate({
                        underline: !(node as TextNode).underline,
                      } as Partial<SceneNode>)
                    }
                  >
                    <TextUnderline size={14} />
                  </Button>
                  <Button
                    variant={
                      (node as TextNode).strikethrough ? "default" : "secondary"
                    }
                    size="sm"
                    className={`flex-1 ${
                      (node as TextNode).strikethrough
                        ? "bg-accent-selection hover:bg-accent-selection/80 text-accent-foreground"
                        : ""
                    }`}
                    onClick={() =>
                      onUpdate({
                        strikethrough: !(node as TextNode).strikethrough,
                      } as Partial<SceneNode>)
                    }
                  >
                    <TextStrikethrough size={14} />
                  </Button>
                </ButtonGroup>
              </div>
            </PropertyRow>
            <div className="flex flex-col gap-1">
              <div className="text-[10px] font-normal text-text-muted">
                Alignment
              </div>
              <PropertyRow>
                <div className="flex items-center gap-1 flex-1">
                  <ButtonGroup orientation="horizontal" className="flex-1">
                    <Button
                      variant={
                        (node as TextNode).textAlign === "left"
                          ? "default"
                          : "secondary"
                      }
                      size="sm"
                      className={`flex-1 ${
                        (node as TextNode).textAlign === "left"
                          ? "bg-accent-selection hover:bg-accent-selection/80 text-accent-foreground"
                          : ""
                      }`}
                      onClick={() =>
                        onUpdate({ textAlign: "left" } as Partial<SceneNode>)
                      }
                    >
                      <TextAlignLeft size={14} />
                    </Button>
                    <Button
                      variant={
                        (node as TextNode).textAlign === "center"
                          ? "default"
                          : "secondary"
                      }
                      size="sm"
                      className={`flex-1 ${
                        (node as TextNode).textAlign === "center"
                          ? "bg-accent-selection hover:bg-accent-selection/80 text-accent-foreground"
                          : ""
                      }`}
                      onClick={() =>
                        onUpdate({ textAlign: "center" } as Partial<SceneNode>)
                      }
                    >
                      <TextAlignCenter size={14} />
                    </Button>
                    <Button
                      variant={
                        (node as TextNode).textAlign === "right"
                          ? "default"
                          : "secondary"
                      }
                      size="sm"
                      className={`flex-1 ${
                        (node as TextNode).textAlign === "right"
                          ? "bg-accent-selection hover:bg-accent-selection/80 text-accent-foreground"
                          : ""
                      }`}
                      onClick={() =>
                        onUpdate({ textAlign: "right" } as Partial<SceneNode>)
                      }
                    >
                      <TextAlignRight size={14} />
                    </Button>
                  </ButtonGroup>
                </div>
                <div className="flex items-center gap-1 flex-1">
                  <ButtonGroup orientation="horizontal" className="flex-1">
                    <Button
                      variant={
                        (node as TextNode).textAlignVertical === "top"
                          ? "default"
                          : "secondary"
                      }
                      size="sm"
                      className={`flex-1 ${
                        (node as TextNode).textAlignVertical === "top"
                          ? "bg-accent-selection hover:bg-accent-selection/80 text-accent-foreground"
                          : ""
                      }`}
                      onClick={() =>
                        onUpdate({
                          textAlignVertical: "top",
                        } as Partial<SceneNode>)
                      }
                    >
                      <AlignTop size={14} />
                    </Button>
                    <Button
                      variant={
                        (node as TextNode).textAlignVertical === "middle"
                          ? "default"
                          : "secondary"
                      }
                      size="sm"
                      className={`flex-1 ${
                        (node as TextNode).textAlignVertical === "middle"
                          ? "bg-accent-selection hover:bg-accent-selection/80 text-accent-foreground"
                          : ""
                      }`}
                      onClick={() =>
                        onUpdate({
                          textAlignVertical: "middle",
                        } as Partial<SceneNode>)
                      }
                    >
                      <AlignCenterVertical size={14} />
                    </Button>
                    <Button
                      variant={
                        (node as TextNode).textAlignVertical === "bottom"
                          ? "default"
                          : "secondary"
                      }
                      size="sm"
                      className={`flex-1 ${
                        (node as TextNode).textAlignVertical === "bottom"
                          ? "bg-accent-selection hover:bg-accent-selection/80 text-accent-foreground"
                          : ""
                      }`}
                      onClick={() =>
                        onUpdate({
                          textAlignVertical: "bottom",
                        } as Partial<SceneNode>)
                      }
                    >
                      <AlignBottom size={14} />
                    </Button>
                  </ButtonGroup>
                </div>
              </PropertyRow>
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-[10px] font-normal text-text-muted">
                Resizing
              </div>
              <ButtonGroup orientation="horizontal" className="w-full">
                <Button
                  variant={
                    (node as TextNode).textWidthMode === "auto"
                      ? "default"
                      : "secondary"
                  }
                  size="sm"
                  className={`flex-1 ${
                    (node as TextNode).textWidthMode === "auto"
                      ? "bg-accent-selection hover:bg-accent-selection/80 text-accent-foreground"
                      : ""
                  }`}
                  onClick={() =>
                    onUpdate({ textWidthMode: "auto" } as Partial<SceneNode>)
                  }
                >
                  <ArrowsOut size={14} />
                </Button>
                <Button
                  variant={
                    (node as TextNode).textWidthMode === "fixed"
                      ? "default"
                      : "secondary"
                  }
                  size="sm"
                  className={`flex-1 ${
                    (node as TextNode).textWidthMode === "fixed"
                      ? "bg-accent-selection hover:bg-accent-selection/80 text-accent-foreground"
                      : ""
                  }`}
                  onClick={() =>
                    onUpdate({ textWidthMode: "fixed" } as Partial<SceneNode>)
                  }
                >
                  <ArrowRight size={14} />
                </Button>
                <Button
                  variant={
                    (node as TextNode).textWidthMode === "fixed-height"
                      ? "default"
                      : "secondary"
                  }
                  size="sm"
                  className={`flex-1 ${
                    (node as TextNode).textWidthMode === "fixed-height"
                      ? "bg-accent-selection hover:bg-accent-selection/80 text-accent-foreground"
                      : ""
                  }`}
                  onClick={() =>
                    onUpdate({
                      textWidthMode: "fixed-height",
                    } as Partial<SceneNode>)
                  }
                >
                  <Article size={14} />
                </Button>
              </ButtonGroup>
            </div>
            <PropertyRow>
              <NumberInput
                label="Line Height"
                labelOutside={true}
                value={(node as TextNode).lineHeight ?? 1.2}
                onChange={(v) =>
                  onUpdate({ lineHeight: v } as Partial<SceneNode>)
                }
                min={0.5}
                max={3}
                step={0.1}
              />
              <NumberInput
                label="Letter Spacing"
                labelOutside={true}
                value={(node as TextNode).letterSpacing ?? 0}
                onChange={(v) =>
                  onUpdate({ letterSpacing: v } as Partial<SceneNode>)
                }
                min={-5}
                max={50}
                step={0.5}
              />
            </PropertyRow>
          </PropertySection>
        </>
      )}
    </div>
  );
}

// Editor for descendant nodes inside an instance
interface DescendantPropertyEditorProps {
  instanceContext: InstanceContext;
  allNodes: SceneNode[];
  variables: Variable[];
  activeTheme: ThemeName;
}

function DescendantPropertyEditor({
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
  const exitInstanceEditMode = useSelectionStore((s) => s.exitInstanceEditMode);

  // Find the instance and component
  const instance = findNodeById(
    allNodes,
    instanceContext.instanceId,
  ) as RefNode | null;
  if (!instance || instance.type !== "ref") return null;

  const component = findComponentById(allNodes, instance.componentId);
  if (!component) return null;

  // Find the original descendant node in the component
  const originalNode = findNodeInComponent(
    component.children,
    instanceContext.descendantId,
  );
  if (!originalNode) return null;

  // Get current override values
  const currentOverride =
    instance.descendants?.[instanceContext.descendantId] || {};

  // Merge original node with overrides for display
  const displayNode = { ...originalNode, ...currentOverride } as SceneNode;

  // Check if a property is overridden
  const isPropertyOverridden = (
    property: keyof DescendantOverride,
  ): boolean => {
    return currentOverride[property] !== undefined;
  };

  // Handle update - save to descendants
  const handleUpdate = (updates: Partial<SceneNode>) => {
    updateDescendantOverride(
      instanceContext.instanceId,
      instanceContext.descendantId,
      updates as DescendantOverride,
    );
  };

  // Reset a specific property
  const handleResetProperty = (property: keyof DescendantOverride) => {
    resetDescendantOverride(
      instanceContext.instanceId,
      instanceContext.descendantId,
      property,
    );
  };

  // Reset all overrides for this descendant
  const handleResetAll = () => {
    resetDescendantOverride(
      instanceContext.instanceId,
      instanceContext.descendantId,
    );
  };

  // Filter only color variables
  const colorVariables = variables.filter((v) => v.type === "color");

  // Handler for fill variable binding
  const handleFillVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      handleUpdate({ fillBinding: { variableId } });
    } else {
      handleUpdate({ fillBinding: undefined });
    }
  };

  // Handler for stroke variable binding
  const handleStrokeVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      handleUpdate({ strokeBinding: { variableId } });
    } else {
      handleUpdate({ strokeBinding: undefined });
    }
  };

  // Collect overridden properties for display
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
    <div className="flex flex-col gap-4">
      {/* Descendant Info */}
      <PropertySection title="Editing Descendant">
        <div className="flex items-center gap-2 text-xs text-purple-400">
          <svg viewBox="0 0 16 16" className="w-4 h-4">
            <path
              d="M8 2 L14 8 L8 14 L2 8 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          <span>{originalNode.name || originalNode.type}</span>
        </div>
        <div className="text-[10px] text-text-muted mt-1">
          In instance: {instance.name || "Instance"}
        </div>
        <button
          onClick={exitInstanceEditMode}
          className="mt-2 px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-text-secondary text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
        >
          Exit Edit Mode
        </button>
      </PropertySection>

      {/* Enabled Toggle */}
      <PropertySection title="Visibility">
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <CheckboxInput
              label="Enabled"
              checked={displayNode.enabled !== false}
              onChange={(v) => handleUpdate({ enabled: v ? undefined : false })}
            />
          </div>
          <OverrideIndicator
            isOverridden={isPropertyOverridden("enabled")}
            onReset={() => handleResetProperty("enabled")}
          />
        </div>
      </PropertySection>

      {/* Fill Section */}
      <PropertySection title="Fill">
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <ColorInput
              value={displayNode.fill ?? originalNode.fill ?? "#000000"}
              onChange={(v) => handleUpdate({ fill: v })}
              variableId={displayNode.fillBinding?.variableId}
              onVariableChange={handleFillVariableChange}
              availableVariables={colorVariables}
              activeTheme={activeTheme}
            />
          </div>
          <OverrideIndicator
            isOverridden={isPropertyOverridden("fill")}
            onReset={() => handleResetProperty("fill")}
          />
        </div>
      </PropertySection>

      {/* Stroke Section */}
      <PropertySection title="Stroke">
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <ColorInput
              value={displayNode.stroke ?? originalNode.stroke ?? ""}
              onChange={(v) => handleUpdate({ stroke: v || undefined })}
              variableId={displayNode.strokeBinding?.variableId}
              onVariableChange={handleStrokeVariableChange}
              availableVariables={colorVariables}
              activeTheme={activeTheme}
            />
          </div>
          <OverrideIndicator
            isOverridden={isPropertyOverridden("stroke")}
            onReset={() => handleResetProperty("stroke")}
          />
        </div>
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <NumberInput
              label="Weight"
              labelOutside={true}
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

      {/* Overrides Summary */}
      {overriddenProperties.length > 0 && (
        <PropertySection title="Overrides">
          <div className="text-xs text-text-secondary mb-2">
            {overriddenProperties.join(", ")}
          </div>
          <button
            onClick={handleResetAll}
            className="px-3 py-1.5 bg-surface-elevated border border-border-light rounded text-text-secondary text-xs cursor-pointer transition-colors hover:bg-surface-hover hover:border-border-hover"
          >
            Reset All Overrides
          </button>
        </PropertySection>
      )}
    </div>
  );
}

// Export section component
interface ExportSectionProps {
  selectedNode: SceneNode | null;
}

function ExportSection({ selectedNode }: ExportSectionProps) {
  const stageRef = useCanvasRefStore((s) => s.stageRef);
  const [scale, setScale] = useState<ExportScale>(1);
  const [format, setFormat] = useState<ExportFormat>("png");

  const handleExport = () => {
    if (!stageRef) {
      console.error("Stage ref not available");
      return;
    }

    exportImage(stageRef, selectedNode?.id || null, selectedNode?.name, {
      format,
      scale,
    });
  };

  const scaleOptions = [
    { value: "1", label: "1×" },
    { value: "2", label: "2×" },
    { value: "3", label: "3×" },
  ];

  const formatOptions = [
    { value: "png", label: "PNG" },
    { value: "jpeg", label: "JPEG" },
  ];

  const exportName = selectedNode?.name || "Untitled";

  return (
    <PropertySection title="Export">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SelectWithOptions
              value={String(scale)}
              onValueChange={(v) => setScale(Number(v) as ExportScale)}
              options={scaleOptions}
              size="sm"
              className="w-full"
            />
          </div>
          <div className="flex-1">
            <SelectWithOptions
              value={format}
              onValueChange={(v) => setFormat(v as ExportFormat)}
              options={formatOptions}
              size="sm"
              className="w-full"
            />
          </div>
        </div>
        <Button onClick={handleExport} variant="secondary" className="w-full">
          Export {exportName}
        </Button>
      </div>
    </PropertySection>
  );
}

export function PropertiesPanel() {
  const nodes = useSceneStore((s) => s.nodes);
  const updateNode = useSceneStore((s) => s.updateNode);
  const { selectedIds, instanceContext } = useSelectionStore();
  const variables = useVariableStore((s) => s.variables);
  const activeTheme = useThemeStore((s) => s.activeTheme);

  // Find selected node (recursively search in tree)
  const selectedNode =
    selectedIds.length === 1 ? findNodeById(nodes, selectedIds[0]) : null;

  // Get parent context for sizing controls
  const parentContext: ParentContext = selectedNode
    ? findParentFrame(nodes, selectedNode.id)
    : { parent: null, isInsideAutoLayout: false };

  // Handle update with type-safe callback
  const handleUpdate = (updates: Partial<SceneNode>) => {
    if (selectedNode) {
      updateNode(selectedNode.id, updates);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {selectedIds.length === 0 && <PageProperties />}
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
    </div>
  );
}
