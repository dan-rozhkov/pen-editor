import {
  AlignBottom,
  AlignCenterVertical,
  AlignTop,
  ArrowsOut,
  ArrowRight,
  Article,
  CaretDownIcon,
  LinkBreakIcon,
  ListBullets,
  ListNumbers,
  MinusIcon,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextIndent,
  TextItalic,
  TextOutdent,
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useTextStyleStore } from "@/store/textStyleStore";
import { TEXT_STYLE_PROPERTY_KEYS } from "@/types/textStyle";
import { getParagraphAttrs, splitParagraphs } from "@/lib/textLists/paragraphs";
import { changeIndentLevel, toggleListType } from "@/lib/textLists/listEditing";

interface TypographySectionProps {
  node: TextNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

const STYLE_MANAGED_KEYS: readonly string[] = TEXT_STYLE_PROPERTY_KEYS;

/** Picker for the named text style bound to this node: apply / create / detach. */
function TextStyleField({ node }: { node: TextNode }) {
  const textStyles = useTextStyleStore((s) => s.textStyles);
  const applyStyleToNode = useTextStyleStore((s) => s.applyStyleToNode);
  const detachStyleFromNode = useTextStyleStore((s) => s.detachStyleFromNode);
  const createStyleFromNode = useTextStyleStore((s) => s.createStyleFromNode);
  const boundStyle = node.textStyleId
    ? textStyles.find((s) => s.id === node.textStyleId)
    : undefined;

  // applyStyleToNode/detachStyleFromNode/createStyleFromNode mutate the scene
  // store directly (they need to update literal typography fields to keep
  // rendering/measurement in sync), so this field bypasses the `onUpdate` prop
  // entirely — the scene store update re-renders the panel from the fresh node.

  return (
    <PropertyRow>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <button
            type="button"
            className="flex-1 flex items-center justify-between gap-1 h-7 px-2 rounded-md bg-secondary text-xs text-text-primary hover:bg-secondary/80"
          >
            <span className="truncate">
              {boundStyle ? boundStyle.name : "No text style"}
            </span>
            <CaretDownIcon size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-[180px] bg-popover text-popover-foreground ring-foreground/10 rounded-lg shadow-md ring-1"
        >
          {textStyles.length === 0 && (
            <div className="px-2 py-1.5 text-[11px] text-text-disabled">
              No text styles yet
            </div>
          )}
          {textStyles.map((style) => (
            <DropdownMenuItem
              key={style.id}
              className="text-xs cursor-pointer"
              onClick={() => applyStyleToNode(node.id, style.id)}
            >
              {style.name}
            </DropdownMenuItem>
          ))}
          {textStyles.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem
            className="text-xs cursor-pointer"
            onClick={() =>
              createStyleFromNode(node.id, node.name || "New text style")
            }
          >
            Create style from this text
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {node.textStyleId && (
        <button
          type="button"
          title="Detach from style"
          aria-label="Detach from style"
          className="p-1.5 rounded hover:bg-secondary text-text-muted hover:text-text-primary transition-colors"
          onClick={() => detachStyleFromNode(node.id)}
        >
          <LinkBreakIcon size={14} />
        </button>
      )}
    </PropertyRow>
  );
}

const segmentedButtonGroupClass =
  "h-6 rounded-md bg-secondary gap-px [&>[data-slot]]:rounded-[5px]! [&>[data-slot]]:border [&>[data-slot]~[data-slot]]:border-l";

function TruncateTextIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-3.5"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M3.2 10.4L6 4H7.3L10.1 10.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.4 8H8.9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="5.2" cy="12.2" r="0.7" fill="currentColor" />
      <circle cx="8" cy="12.2" r="0.7" fill="currentColor" />
      <circle cx="10.8" cy="12.2" r="0.7" fill="currentColor" />
    </svg>
  );
}

export function TypographySection({ node, onUpdate }: TypographySectionProps) {
  // Route typography edits: while the node is bound to a text style, changing
  // a style-managed property (fontFamily/fontSize/...) becomes a local
  // override — tracked in `textStyleOverrides` (mirrors ref-instance
  // overrides) — instead of silently drifting from the style with no record
  // of the divergence, so a later centralized style edit correctly skips it.
  const updateTypography = (updates: Partial<TextNode>) => {
    if (node.textStyleId) {
      const overriddenKeys = Object.keys(updates).filter((k) =>
        STYLE_MANAGED_KEYS.includes(k),
      );
      if (overriddenKeys.length > 0) {
        const existing = node.textStyleOverrides ?? [];
        const merged = Array.from(new Set([...existing, ...overriddenKeys]));
        onUpdate({ ...updates, textStyleOverrides: merged } as Partial<SceneNode>);
        return;
      }
    }
    onUpdate(updates as Partial<SceneNode>);
  };

  // Switching the text resize mode must not contradict auto-layout sizing:
  // auto-width can't fill its container, and auto-height can't fill vertically.
  const setTextWidthMode = (mode: TextNode["textWidthMode"]) => {
    const updates: Partial<TextNode> = { textWidthMode: mode };
    const demoteWidthFill =
      mode === "auto" && node.sizing?.widthMode === "fill_container";
    const demoteHeightFill =
      (mode === "auto" || mode === "fixed") &&
      node.sizing?.heightMode === "fill_container";
    if (demoteWidthFill || demoteHeightFill) {
      updates.sizing = {
        ...node.sizing,
        ...(demoteWidthFill ? { widthMode: "fit_content" } : {}),
        ...(demoteHeightFill ? { heightMode: "fit_content" } : {}),
      };
    }
    onUpdate(updates as Partial<SceneNode>);
  };

  // Truncation only applies to wrapped modes (fixed width); auto-width has no
  // box to overflow, mirroring Figma where "Truncate text" is hidden there.
  const isWrapped =
    node.textWidthMode === "fixed" || node.textWidthMode === "fixed-height";

  // The panel operates at whole-node granularity (no caret/selection context
  // here — that's InlineTextEditor's job for in-place editing): toggling a
  // list button applies to every paragraph, and the active/indicator state
  // reflects the first paragraph's attrs.
  const paragraphCount = splitParagraphs(node.text).length;
  const firstParagraphAttrs = getParagraphAttrs(node, 0);

  const applyListType = (type: "bullet" | "number") => {
    const updated = toggleListType(node.paragraphs, paragraphCount, 0, paragraphCount - 1, type);
    onUpdate({ paragraphs: updated } as Partial<SceneNode>);
  };

  const applyIndent = (direction: 1 | -1) => {
    let updated = node.paragraphs ? node.paragraphs.map((p) => ({ ...p })) : [];
    for (let i = 0; i < paragraphCount; i++) {
      updated = changeIndentLevel(updated, paragraphCount, i, direction);
    }
    onUpdate({ paragraphs: updated } as Partial<SceneNode>);
  };

  return (
    <PropertySection title="Typography">
      <TextStyleField node={node} />
      <FontCombobox
        value={node.fontFamily ?? "Arial"}
        onChange={(v) =>
          updateTypography({ fontFamily: v })
        }
      />
      <PropertyRow>
        <NumberInput
          value={node.fontSize ?? 16}
          onChange={(v) =>
            updateTypography({ fontSize: v })
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
            updateTypography({ fontWeight: v })
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
                ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
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
          <ButtonGroup orientation="horizontal" className={`flex-1 ${segmentedButtonGroupClass}`}>
            <Button
              variant={node.underline ? "default" : "secondary"}
              size="sm"
              className={`flex-1 ${
                node.underline
                  ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
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
                  ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
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
          Transform
        </div>
        <SelectInput
          value={node.textTransform ?? "none"}
          options={[
            { value: "none", label: "None" },
            { value: "uppercase", label: "Uppercase" },
            { value: "lowercase", label: "Lowercase" },
            { value: "capitalize", label: "Capitalize" },
          ]}
          onChange={(v) =>
            updateTypography({ textTransform: v as TextNode["textTransform"] })
          }
        />
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-[10px] font-normal text-text-muted">
          Alignment
        </div>
        <PropertyRow>
          <div className="flex items-center gap-1 flex-1">
            <ButtonGroup orientation="horizontal" className={`flex-1 ${segmentedButtonGroupClass}`}>
              <Button
                variant={
                  node.textAlign === "left" ? "default" : "secondary"
                }
                size="sm"
                className={`flex-1 ${
                  node.textAlign === "left"
                    ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
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
                    ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
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
                    ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
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
            <ButtonGroup orientation="horizontal" className={`flex-1 ${segmentedButtonGroupClass}`}>
              <Button
                variant={
                  node.textAlignVertical === "top"
                    ? "default"
                    : "secondary"
                }
                size="sm"
                className={`flex-1 ${
                  node.textAlignVertical === "top"
                    ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
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
                    ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
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
                    ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
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
          List
        </div>
        <PropertyRow>
          <div className="flex items-center gap-1 flex-1">
            <ButtonGroup orientation="horizontal" className={`flex-1 ${segmentedButtonGroupClass}`}>
              <Button
                variant={firstParagraphAttrs.listType === "bullet" ? "default" : "secondary"}
                size="sm"
                title="Bulleted list (⌘⇧8)"
                aria-label="Bulleted list"
                aria-pressed={firstParagraphAttrs.listType === "bullet"}
                className={`flex-1 ${
                  firstParagraphAttrs.listType === "bullet"
                    ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
                    : ""
                }`}
                onClick={() => applyListType("bullet")}
              >
                <ListBullets size={14} />
              </Button>
              <Button
                variant={firstParagraphAttrs.listType === "number" ? "default" : "secondary"}
                size="sm"
                title="Numbered list (⌘⇧7)"
                aria-label="Numbered list"
                aria-pressed={firstParagraphAttrs.listType === "number"}
                className={`flex-1 ${
                  firstParagraphAttrs.listType === "number"
                    ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
                    : ""
                }`}
                onClick={() => applyListType("number")}
              >
                <ListNumbers size={14} />
              </Button>
            </ButtonGroup>
          </div>
          <div className="flex items-center gap-1 flex-1">
            <ButtonGroup orientation="horizontal" className={`flex-1 ${segmentedButtonGroupClass}`}>
              <Button
                variant="secondary"
                size="sm"
                title="Outdent (Shift+Tab)"
                aria-label="Outdent"
                className="flex-1"
                onClick={() => applyIndent(-1)}
              >
                <TextOutdent size={14} />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                title="Indent (Tab)"
                aria-label="Indent"
                className="flex-1"
                onClick={() => applyIndent(1)}
              >
                <TextIndent size={14} />
              </Button>
            </ButtonGroup>
          </div>
        </PropertyRow>
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-[10px] font-normal text-text-muted">
          Resizing
        </div>
        <ButtonGroup orientation="horizontal" className={`w-full ${segmentedButtonGroupClass}`}>
          <Button
            variant={
              node.textWidthMode === "auto" ? "default" : "secondary"
            }
            size="sm"
            title="Auto width"
            aria-label="Auto width"
            className={`flex-1 ${
              node.textWidthMode === "auto"
                ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
                : ""
            }`}
            onClick={() => setTextWidthMode("auto")}
          >
            <ArrowsOut size={14} />
          </Button>
          <Button
            variant={
              node.textWidthMode === "fixed" ? "default" : "secondary"
            }
            size="sm"
            title="Fixed width"
            aria-label="Fixed width"
            className={`flex-1 ${
              node.textWidthMode === "fixed"
                ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
                : ""
            }`}
            onClick={() => setTextWidthMode("fixed")}
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
            title="Fixed size"
            aria-label="Fixed size"
            className={`flex-1 ${
              node.textWidthMode === "fixed-height"
                ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
                : ""
            }`}
            onClick={() => setTextWidthMode("fixed-height")}
          >
            <Article size={14} />
          </Button>
        </ButtonGroup>
      </div>
      {isWrapped && (
        <PropertyRow>
          <div className="flex flex-1 flex-col gap-1">
            <div className="text-[10px] font-normal text-text-muted">
              Truncate text
            </div>
            <ButtonGroup orientation="horizontal" className={`w-full ${segmentedButtonGroupClass}`}>
              <Button
                variant={!node.truncateText ? "default" : "secondary"}
                size="sm"
                title="No truncation"
                aria-label="No truncation"
                aria-pressed={!node.truncateText}
                className={`flex-1 ${
                  !node.truncateText
                    ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
                    : ""
                }`}
                onClick={() =>
                  onUpdate({
                    truncateText: false,
                  } as Partial<SceneNode>)
                }
              >
                <MinusIcon size={14} />
              </Button>
              <Button
                variant={node.truncateText ? "default" : "secondary"}
                size="sm"
                title="Truncate with ellipsis"
                aria-label="Truncate with ellipsis"
                aria-pressed={!!node.truncateText}
                className={`flex-1 ${
                  node.truncateText
                    ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
                    : ""
                }`}
                onClick={() =>
                  onUpdate({
                    truncateText: true,
                  } as Partial<SceneNode>)
                }
              >
                <TruncateTextIcon />
              </Button>
            </ButtonGroup>
          </div>
          <NumberInput
            label="Max Lines"
            labelOutside={true}
            value={node.maxLines ?? 0}
            onChange={(v) =>
              onUpdate({
                maxLines: v >= 1 ? Math.floor(v) : undefined,
              } as Partial<SceneNode>)
            }
            min={0}
            step={1}
          />
        </PropertyRow>
      )}
      <PropertyRow>
        <NumberInput
          label="Line Height"
          labelOutside={true}
          value={node.lineHeight ?? 1.2}
          onChange={(v) =>
            updateTypography({ lineHeight: v })
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
            updateTypography({ letterSpacing: v })
          }
          min={-5}
          max={50}
          step={0.5}
        />
      </PropertyRow>
    </PropertySection>
  );
}
