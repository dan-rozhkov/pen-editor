import {
  AlignBottom,
  AlignCenterVertical,
  AlignTop,
  ArrowsOut,
  ArrowClockwise,
  ArrowRight,
  Article,
  DiamondsFour,
  LayoutIcon,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextItalic,
  TextStrikethrough,
  TextUnderline,
} from "@phosphor-icons/react";
import { useSceneStore } from "@/store/sceneStore";
import type {
  AlignItems,
  FlexDirection,
  JustifyContent,
  PolygonNode,
  SceneNode,
  SizingMode,
} from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import { findComponentById, type ParentContext } from "@/utils/nodeUtils";
import { cn } from "@/lib/utils";
import {
  ColorInput,
  FlipControls,
  NumberInput,
  PropertyRow,
  PropertySection,
  SelectInput,
} from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { FontCombobox } from "@/components/ui/FontCombobox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { GradientEditor } from "@/components/properties/GradientEditor";
import { ImageFillEditor } from "@/components/properties/ImageFillSection";
import { OverrideIndicator } from "@/components/properties/OverrideIndicator";
import type { GradientFill, GradientType } from "@/types/scene";
import { getDefaultGradient } from "@/utils/gradientUtils";

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

export function PropertyEditor({
  node,
  onUpdate,
  parentContext,
  variables,
  activeTheme,
  allNodes,
}: PropertyEditorProps) {
  const component =
    node.type === "ref" ? findComponentById(allNodes, node.componentId) : null;

  const isOverridden = <T,>(
    instanceVal: T | undefined,
    componentVal: T | undefined,
  ): boolean => {
    if (!component) return false;
    return instanceVal !== undefined && instanceVal !== componentVal;
  };

  const resetOverride = (property: keyof SceneNode) => {
    onUpdate({ [property]: undefined } as Partial<SceneNode>);
  };

  const handleFillVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      onUpdate({ fillBinding: { variableId } });
    } else {
      onUpdate({ fillBinding: undefined });
    }
  };

  const handleStrokeVariableChange = (variableId: string | undefined) => {
    if (variableId) {
      onUpdate({ strokeBinding: { variableId } });
    } else {
      onUpdate({ strokeBinding: undefined });
    }
  };

  const colorVariables = variables.filter((v) => v.type === "color");

  return (
    <div className="flex flex-col">
      <PropertySection title="Type">
        <div className="flex items-center gap-2">
          {node.type === "group" ||
          (node.type === "frame" && !node.reusable) ? (
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
              {node.type === "frame" && !node.reusable && (
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

      <PropertySection title="Size">
        {(parentContext.isInsideAutoLayout ||
          (node.type === "frame" && node.layout?.autoLayout)) && (
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
                        ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
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
                        ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
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

      {node.type === "frame" && (
        <PropertySection title="Auto Layout">
          <div className="relative flex justify-end -top-6 -mb-6">
            <Button
              variant={node.layout?.autoLayout ? "default" : "secondary"}
              size="icon"
              className={cn(
                node.layout?.autoLayout
                  ? "bg-sky-100 text-sky-600 hover:bg-sky-100/50 border-none ring-0"
                  : "bg-background hover:bg-surface-hover",
              )}
              onClick={() => {
                const v = !node.layout?.autoLayout;
                const updates: Partial<SceneNode> = {
                  layout: { ...node.layout, autoLayout: v },
                };
                if (v) {
                  updates.sizing = {
                    ...node.sizing,
                    heightMode: "fit_content",
                  };
                }
                onUpdate(updates);
              }}
            >
              <LayoutIcon size={16} />
            </Button>
          </div>
          {node.layout?.autoLayout && (
            <>
              <SelectInput
                label="Direction"
                labelOutside
                value={node.layout?.flexDirection ?? "row"}
                options={[
                  { value: "row", label: "Horizontal" },
                  { value: "column", label: "Vertical" },
                ]}
                onChange={(v) =>
                  onUpdate({
                    layout: {
                      ...node.layout,
                      flexDirection: v as FlexDirection,
                    },
                  } as Partial<SceneNode>)
                }
              />
              <PropertyRow>
                <div className="flex flex-col gap-1 flex-1">
                  <div className="text-[10px] font-normal text-text-muted">
                    Alignment
                  </div>
                  <div className="grid grid-cols-3 bg-secondary rounded-md justify-center items-center p-0.5">
                    {Array.from({ length: 9 }).map((_, index) => {
                      const currentDirection =
                        node.layout?.flexDirection ?? "row";
                      const currentJustify =
                        node.layout?.justifyContent ?? "flex-start";
                      const currentAlign =
                        node.layout?.alignItems ?? "flex-start";

                      const isRow = currentDirection === "row";
                      const col = index % 3;
                      const row = Math.floor(index / 3);

                      const colValues = ["flex-start", "center", "flex-end"];
                      const rowValues = ["flex-start", "center", "flex-end"];

                      const targetAlign = isRow
                        ? rowValues[row]
                        : colValues[col];
                      const targetJustify = isRow
                        ? colValues[col]
                        : rowValues[row];

                      const isCenterColumn = col === 1;
                      const isCenterRow = row === 1;

                      const canToggleSpaceBetween = isRow
                        ? isCenterColumn
                        : isCenterRow;

                      const isSpaceBetween = currentJustify === "space-between";

                      const isActive =
                        currentAlign === targetAlign &&
                        (isSpaceBetween && canToggleSpaceBetween
                          ? true
                          : currentJustify === targetJustify);

                      const handleClick = () => {
                        onUpdate({
                          layout: {
                            ...node.layout,
                            alignItems: targetAlign as AlignItems,
                            justifyContent: targetJustify as JustifyContent,
                          },
                        } as Partial<SceneNode>);
                      };

                      const handleDoubleClick = () => {
                        if (canToggleSpaceBetween) {
                          const newJustify =
                            currentJustify === "space-between"
                              ? "center"
                              : "space-between";
                          onUpdate({
                            layout: {
                              ...node.layout,
                              alignItems: targetAlign as AlignItems,
                              justifyContent: newJustify as JustifyContent,
                            },
                          } as Partial<SceneNode>);
                        }
                      };

                      const showSpaceBetweenIcon =
                        canToggleSpaceBetween &&
                        isSpaceBetween &&
                        currentAlign === targetAlign;

                      return (
                        <button
                          key={index}
                          className={`h-6 rounded flex items-center justify-center ${
                            isActive
                              ? "bg-accent-selection text-text-primary"
                              : "text-text-muted hover:bg-surface-hover"
                          } ${
                            showSpaceBetweenIcon ? "ring-2 ring-blue-400" : ""
                          }`}
                          onClick={handleClick}
                          onDoubleClick={handleDoubleClick}
                          title={
                            canToggleSpaceBetween
                              ? `${isRow ? "H" : "V"}: ${targetJustify}, ${
                                  isRow ? "V" : "H"
                                }: ${targetAlign} (double-click for space-between)`
                              : `${isRow ? "H" : "V"}: ${targetJustify}, ${
                                  isRow ? "V" : "H"
                                }: ${targetAlign}`
                          }
                        >
                          {showSpaceBetweenIcon ? (
                            <div
                              className={`flex ${
                                isRow ? "flex-row gap-0.5" : "flex-col gap-0.5"
                              }`}
                            >
                              <div
                                className={`${
                                  isRow ? "w-0.5 h-3" : "w-3 h-0.5"
                                } bg-current rounded`}
                              />
                              <div
                                className={`${
                                  isRow ? "w-0.5 h-3" : "w-3 h-0.5"
                                } bg-current rounded`}
                              />
                              <div
                                className={`${
                                  isRow ? "w-0.5 h-3" : "w-3 h-0.5"
                                } bg-current rounded`}
                              />
                            </div>
                          ) : (
                            <div className="w-1 h-1 rounded-full bg-primary" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <NumberInput
                  label="Gap"
                  value={node.layout?.gap ?? 0}
                  onChange={(v) =>
                    onUpdate({
                      layout: { ...node.layout, gap: v },
                    } as Partial<SceneNode>)
                  }
                  min={0}
                  labelOutside={true}
                />
              </PropertyRow>
              <label className="text-[10px] text-text-muted tracking-wide mt-2">
                Padding
              </label>
              <PropertyRow>
                <NumberInput
                  label="T"
                  value={node.layout?.paddingTop ?? 0}
                  onChange={(v) =>
                    onUpdate({
                      layout: { ...node.layout, paddingTop: v },
                    } as Partial<SceneNode>)
                  }
                  min={0}
                />
                <NumberInput
                  label="R"
                  value={node.layout?.paddingRight ?? 0}
                  onChange={(v) =>
                    onUpdate({
                      layout: {
                        ...node.layout,
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
                  value={node.layout?.paddingBottom ?? 0}
                  onChange={(v) =>
                    onUpdate({
                      layout: {
                        ...node.layout,
                        paddingBottom: v,
                      },
                    } as Partial<SceneNode>)
                  }
                  min={0}
                />
                <NumberInput
                  label="L"
                  value={node.layout?.paddingLeft ?? 0}
                  onChange={(v) =>
                    onUpdate({
                      layout: { ...node.layout, paddingLeft: v },
                    } as Partial<SceneNode>)
                  }
                  min={0}
                />
              </PropertyRow>
            </>
          )}
        </PropertySection>
      )}

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
          {node.type === "polygon" && (
            <NumberInput
              label="Sides"
              value={(node as PolygonNode).sides ?? 6}
              onChange={(v) => {
                const sides = Math.max(3, Math.min(12, v));
                const w = node.width;
                const h = node.height;
                const points: number[] = [];
                for (let i = 0; i < sides; i++) {
                  const angle = (2 * Math.PI * i) / sides - Math.PI / 2;
                  points.push(w / 2 + (w / 2) * Math.cos(angle));
                  points.push(h / 2 + (h / 2) * Math.sin(angle));
                }
                onUpdate({ sides, points } as Partial<SceneNode>);
              }}
              min={3}
              max={12}
              step={1}
              labelOutside={true}
            />
          )}
        </PropertyRow>
      </PropertySection>

      <PropertySection title="Fill">
        {(() => {
          const supportsImage = node.type === "rect" || node.type === "ellipse" || node.type === "frame";
          const fillMode = node.imageFill ? "image" : (node.gradientFill?.type ?? "solid");
          const fillOptions = [
            { value: "solid", label: "Solid" },
            { value: "linear", label: "Linear" },
            { value: "radial", label: "Radial" },
            ...(supportsImage ? [{ value: "image", label: "Image" }] : []),
          ];
          return (
            <>
              <SelectInput
                value={fillMode}
                options={fillOptions}
                onChange={(v) => {
                  if (v === "image") {
                    // Set a placeholder imageFill so fillMode stays "image"
                    const updates: Partial<SceneNode> = { gradientFill: undefined } as Partial<SceneNode>;
                    if (!node.imageFill) {
                      (updates as Record<string, unknown>).imageFill = { url: "", mode: "fill" };
                    }
                    onUpdate(updates);
                  } else if (v === "solid") {
                    onUpdate({ gradientFill: undefined, imageFill: undefined } as Partial<SceneNode>);
                  } else {
                    const currentGradient = node.gradientFill;
                    const updates: Partial<SceneNode> = { imageFill: undefined } as Partial<SceneNode>;
                    if (currentGradient && currentGradient.type !== v) {
                      updates.gradientFill = {
                        ...getDefaultGradient(v as GradientType),
                        stops: currentGradient.stops,
                      };
                    } else if (!currentGradient) {
                      updates.gradientFill = getDefaultGradient(v as GradientType);
                    }
                    onUpdate(updates);
                  }
                }}
              />
              {fillMode === "image" ? (
                <ImageFillEditor imageFill={node.imageFill} onUpdate={onUpdate} />
              ) : node.gradientFill ? (
                <GradientEditor
                  gradient={node.gradientFill}
                  onChange={(g: GradientFill) => onUpdate({ gradientFill: g })}
                />
              ) : (
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
                  <div className="w-20">
                    <NumberInput
                      label="%"
                      value={Math.round((node.fillOpacity ?? 1) * 100)}
                      onChange={(v) =>
                        onUpdate({
                          fillOpacity: Math.max(0, Math.min(100, v)) / 100,
                        })
                      }
                      min={0}
                      max={100}
                      step={1}
                    />
                  </div>
                  <OverrideIndicator
                    isOverridden={isOverridden(node.fill, component?.fill)}
                    onReset={() => resetOverride("fill")}
                  />
                </div>
              )}
            </>
          );
        })()}
      </PropertySection>

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
          <div className="w-20">
            <NumberInput
              label="%"
              value={Math.round((node.strokeOpacity ?? 1) * 100)}
              onChange={(v) =>
                onUpdate({ strokeOpacity: Math.max(0, Math.min(100, v)) / 100 })
              }
              min={0}
              max={100}
              step={1}
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

      {node.type === "frame" && (
        <PropertySection title="Theme">
          <SelectInput
            value={node.themeOverride ?? "inherit"}
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

      {node.type === "ref" &&
        (() => {
          const comp = findComponentById(allNodes, node.componentId);

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
                value={node.fontWeight ?? "normal"}
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
                    node.fontStyle === "italic" ? "default" : "secondary"
                  }
                  size="sm"
                  className={`flex-1 ${
                    node.fontStyle === "italic"
                      ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
                      : ""
                  }`}
                  onClick={() =>
                    onUpdate({
                      fontStyle:
                        node.fontStyle === "italic" ? "normal" : "italic",
                    } as Partial<SceneNode>)
                  }
                >
                  <TextItalic size={14} />
                </Button>
              </div>
              <div className="flex items-center gap-1 flex-1">
                <ButtonGroup orientation="horizontal" className="flex-1">
                  <Button
                    variant={node.underline ? "default" : "secondary"}
                    size="sm"
                    className={`flex-1 ${
                      node.underline
                        ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
                        : ""
                    }`}
                    onClick={() =>
                      onUpdate({
                        underline: !node.underline,
                      } as Partial<SceneNode>)
                    }
                  >
                    <TextUnderline size={14} />
                  </Button>
                  <Button
                    variant={node.strikethrough ? "default" : "secondary"}
                    size="sm"
                    className={`flex-1 ${
                      node.strikethrough
                        ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
                        : ""
                    }`}
                    onClick={() =>
                      onUpdate({
                        strikethrough: !node.strikethrough,
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
                        node.textAlign === "left" ? "default" : "secondary"
                      }
                      size="sm"
                      className={`flex-1 ${
                        node.textAlign === "left"
                          ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
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
                        node.textAlign === "center" ? "default" : "secondary"
                      }
                      size="sm"
                      className={`flex-1 ${
                        node.textAlign === "center"
                          ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
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
                        node.textAlign === "right" ? "default" : "secondary"
                      }
                      size="sm"
                      className={`flex-1 ${
                        node.textAlign === "right"
                          ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
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
                        node.textAlignVertical === "top"
                          ? "default"
                          : "secondary"
                      }
                      size="sm"
                      className={`flex-1 ${
                        node.textAlignVertical === "top"
                          ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
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
                        node.textAlignVertical === "middle"
                          ? "default"
                          : "secondary"
                      }
                      size="sm"
                      className={`flex-1 ${
                        node.textAlignVertical === "middle"
                          ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
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
                        node.textAlignVertical === "bottom"
                          ? "default"
                          : "secondary"
                      }
                      size="sm"
                      className={`flex-1 ${
                        node.textAlignVertical === "bottom"
                          ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
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
                    node.textWidthMode === "auto" ? "default" : "secondary"
                  }
                  size="sm"
                  className={`flex-1 ${
                    node.textWidthMode === "auto"
                      ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
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
                    node.textWidthMode === "fixed" ? "default" : "secondary"
                  }
                  size="sm"
                  className={`flex-1 ${
                    node.textWidthMode === "fixed"
                      ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
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
                    node.textWidthMode === "fixed-height"
                      ? "default"
                      : "secondary"
                  }
                  size="sm"
                  className={`flex-1 ${
                    node.textWidthMode === "fixed-height"
                      ? "bg-accent-selection hover:bg-accent-selection/80 text-text-primary"
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
                value={node.lineHeight ?? 1.2}
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
                value={node.letterSpacing ?? 0}
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
