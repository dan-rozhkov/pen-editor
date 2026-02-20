import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import type {
  AlignItems,
  FlexDirection,
  FrameNode,
  JustifyContent,
  SceneNode,
} from "@/types/scene";
import {
  NumberInput,
  PropertyRow,
  PropertySection,
  SelectInput,
} from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";

interface AutoLayoutSectionProps {
  node: FrameNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  mixedKeys?: Set<string>;
}

export function AutoLayoutSection({ node, onUpdate, mixedKeys }: AutoLayoutSectionProps) {
  const hasAutoLayout = !!node.layout?.autoLayout;

  const enableAutoLayout = () => {
    const updates: Partial<SceneNode> = {
      layout: { ...node.layout, autoLayout: true },
    };
    updates.sizing = {
      ...node.sizing,
      heightMode: "fit_content",
    };
    onUpdate(updates);
  };

  const disableAutoLayout = () => {
    onUpdate({
      layout: { ...node.layout, autoLayout: false },
    } as Partial<SceneNode>);
  };

  const isMixed = (key: string) => mixedKeys?.has(key) ?? false;

  return (
    <PropertySection
      title="Auto Layout"
      action={
        !hasAutoLayout ? (
          <Button variant="ghost" size="icon-sm" onClick={enableAutoLayout}>
            <PlusIcon />
          </Button>
        ) : (
          <Button variant="ghost" size="icon-sm" onClick={disableAutoLayout}>
            <MinusIcon />
          </Button>
        )
      }
    >
      {hasAutoLayout && (
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
            isMixed={isMixed("layout.flexDirection")}
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

                  const alignmentMixed = isMixed("layout.alignItems") || isMixed("layout.justifyContent");

                  const isActive =
                    !alignmentMixed &&
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
                    !alignmentMixed &&
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
              isMixed={isMixed("layout.gap")}
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
              isMixed={isMixed("layout.paddingTop")}
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
              isMixed={isMixed("layout.paddingRight")}
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
              isMixed={isMixed("layout.paddingBottom")}
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
              isMixed={isMixed("layout.paddingLeft")}
            />
          </PropertyRow>
        </>
      )}
    </PropertySection>
  );
}
