import {
  AlignBottom,
  AlignCenterVertical,
  AlignTop,
  ArrowsOut,
  ArrowRight,
  Article,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextItalic,
  TextStrikethrough,
  TextUnderline,
} from "@phosphor-icons/react";
import type { SceneNode, TextNode } from "@/types/scene";
import {
  NumberInput,
  PropertyRow,
  PropertySection,
  SelectInput,
} from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { FontCombobox } from "@/components/ui/FontCombobox";

interface TypographySectionProps {
  node: TextNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

export function TypographySection({ node, onUpdate }: TypographySectionProps) {
  return (
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
  );
}
