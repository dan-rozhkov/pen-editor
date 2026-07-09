import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  AlignBottom,
  AlignCenterVertical,
  AlignTop,
  ArrowsOut,
  ArrowRight,
  Article,
  CheckIcon,
  LinkIcon,
  LinkSimpleIcon,
  ListBullets,
  ListNumbers,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextIndent,
  TextItalic,
  TextOutdent,
  TextStrikethrough,
  TextUnderline,
  XIcon,
  IconContext,
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
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTextStyleStore } from "@/store/textStyleStore";
import { TEXT_STYLE_PROPERTY_KEYS, type TextStyle } from "@/types/textStyle";
import { MAX_INDENT_LEVEL, getParagraphAttrs, normalizeParagraphs, splitParagraphs } from "@/lib/textLists/paragraphs";
import { toggleListType } from "@/lib/textLists/listEditing";
import { isTypingTarget } from "@/components/canvas/keyboardShortcutUtils";
import { Slider } from "@/components/ui/slider";
import { getVariableFontAxes, type FontAxis } from "@/utils/variableFont";

interface TypographySectionProps {
  node: TextNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

const STYLE_MANAGED_KEYS: readonly string[] = TEXT_STYLE_PROPERTY_KEYS;
const TYPOGRAPHY_POPOVER_PANEL_OFFSET = 252;

function textStyleMeta(style: TextStyle): string {
  const metrics = [
    style.fontSize !== undefined ? String(style.fontSize) : null,
    style.lineHeight !== undefined ? String(style.lineHeight) : null,
  ].filter(Boolean);
  return metrics.length > 0 ? metrics.join("/") : style.fontFamily || "";
}

function TextStyleRow({
  style,
  isBound,
  onApply,
}: {
  style: TextStyle;
  isBound: boolean;
  onApply: () => void;
}) {
  const updateTextStyle = useTextStyleStore((s) => s.updateTextStyle);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const meta = textStyleMeta(style);

  const startRename = () => {
    setIsEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.select();
    });
  };

  const commitRename = () => {
    const trimmed = inputRef.current?.value.trim();
    if (trimmed) {
      updateTextStyle(style.id, { name: trimmed });
    }
    setIsEditing(false);
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsEditing(false);
    }
  };

  const handleRowKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isEditing) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onApply();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-secondary"
      onClick={() => {
        if (!isEditing) onApply();
      }}
      onKeyDown={handleRowKeyDown}
    >
      <span
        className="w-5 shrink-0 text-sm leading-none text-text-primary"
        style={{
          fontFamily: style.fontFamily,
          fontWeight: style.fontWeight,
        }}
        aria-hidden="true"
      >
        Ag
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            defaultValue={style.name}
            onKeyDown={handleInputKeyDown}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none"
            autoFocus
          />
        ) : (
          <span
            className="min-w-0 truncate text-xs text-text-primary"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation();
              startRename();
            }}
          >
            {style.name}
          </span>
        )}
        {meta && (
          <span className="shrink-0 text-[11px] text-text-muted">
            {meta}
          </span>
        )}
      </span>
      {isBound && <CheckIcon size={14} className="text-text-muted" />}
    </div>
  );
}

/** Popover for applying an existing text style or creating one from this node. */
function TextStylesPopover({ node }: { node: TextNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const textStyles = useTextStyleStore((s) => s.textStyles);
  const applyStyleToNode = useTextStyleStore((s) => s.applyStyleToNode);
  const createStyleFromNode = useTextStyleStore((s) => s.createStyleFromNode);
  const boundStyle = node.textStyleId
    ? textStyles.find((s) => s.id === node.textStyleId)
    : undefined;

  const filteredStyles = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return textStyles;
    return textStyles.filter((style) =>
      [style.name, style.fontFamily, textStyleMeta(style)]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [query, textStyles]);

  // applyStyleToNode/detachStyleFromNode/createStyleFromNode mutate the scene
  // store directly (they need to update literal typography fields to keep
  // rendering/measurement in sync), so this popover bypasses the `onUpdate` prop
  // entirely — the scene store update re-renders the panel from the fresh node.

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Text styles"
          aria-label="Text styles"
        >
          <PlusIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={TYPOGRAPHY_POPOVER_PANEL_OFFSET}
        className="w-[240px] max-h-[360px] gap-0 overflow-hidden rounded-xl border-border-default p-0"
      >
        <div className="flex h-10 items-center justify-between border-b border-input px-3">
          <div className="text-xs font-semibold text-text-primary">Text styles</div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="flex size-6 items-center justify-center rounded-md text-text-primary hover:bg-secondary"
              title="Create text style"
              aria-label="Create text style"
              onClick={() => createStyleFromNode(node.id, node.name || "New text style")}
            >
              <PlusIcon size={14} />
            </button>
            <button
              type="button"
              className="flex size-6 items-center justify-center rounded-md text-text-primary hover:bg-secondary"
              title="Close"
              aria-label="Close text styles"
              onClick={() => setOpen(false)}
            >
              <XIcon size={14} />
            </button>
          </div>
        </div>
        <label className="flex h-9 items-center gap-2 px-3 text-text-muted">
          <MagnifyingGlassIcon size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="min-w-0 flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
          />
        </label>
        <div className="max-h-[270px] overflow-auto py-1">
          {filteredStyles.length === 0 ? (
            <div className="px-3 py-5 text-center text-xs text-text-muted">
              {textStyles.length === 0 ? "No text styles yet" : "No matching text styles"}
            </div>
          ) : (
            filteredStyles.map((style) => {
              const isBound = style.id === boundStyle?.id;
              return (
                <TextStyleRow
                  key={style.id}
                  style={style}
                  isBound={isBound}
                  onApply={() => {
                    applyStyleToNode(node.id, style.id);
                    setOpen(false);
                  }}
                />
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Popover for adding/editing/removing a text node's `link` attribute (Figma
 * "Link" panel). Opens on click, or via Cmd/Ctrl+K while the canvas (not
 * some other text input) has focus — mirrors the ⌘K binding note in the
 * task spec. Operates at whole-node granularity, same as every other
 * typography control in this panel (bold/italic/underline/...): there is no
 * per-character text-range selection in this app's scene graph.
 */
function LinkPopover({ node, onUpdate }: { node: TextNode; onUpdate: (updates: Partial<SceneNode>) => void }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.code !== "KeyK") return;
      // Don't hijack ⌘K while the user is typing elsewhere (chat input,
      // layer rename, another popover's own field, ...) — same guard the
      // canvas-level shortcuts use.
      if (isTypingTarget(e)) return;
      e.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const commitUrl = () => {
    const trimmed = (inputRef.current?.value ?? "").trim();
    if (!trimmed) {
      if (node.link) onUpdate({ link: undefined } as Partial<SceneNode>);
      return;
    }
    if (trimmed === node.link?.url) return;
    onUpdate({
      link: node.link?.title ? { url: trimmed, title: node.link.title } : { url: trimmed },
    } as Partial<SceneNode>);
  };

  const removeLink = () => {
    onUpdate({ link: undefined } as Partial<SceneNode>);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      // `onOpenChange` is base-ui's own notification for interactions it
      // owns (outside click, its internal Escape handling) — it does NOT
      // fire just because we set `open` ourselves below, so it only needs
      // to cover the "commit on outside click" case; Enter/Escape inside
      // the input commit (or intentionally skip) explicitly instead.
      onOpenChange={(next) => {
        if (!next) commitUrl();
        setOpen(next);
      }}
    >
      <PopoverTrigger>
        <Button
          variant={node.link ? "default" : "secondary"}
          size="icon-sm"
          title="Link (⌘K)"
          aria-label="Link"
          className={
            node.link
              ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
              : ""
          }
        >
          <LinkSimpleIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" sideOffset={TYPOGRAPHY_POPOVER_PANEL_OFFSET} className="w-[240px] gap-2">
        <div className="text-xs font-semibold text-text-primary">Link</div>
        <Input
          key={`${node.id}:${open}`}
          ref={inputRef}
          defaultValue={node.link?.url ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              commitUrl();
              setOpen(false);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation(); // cancel: skip commitUrl, and don't let base-ui's own Escape handling commit either
              setOpen(false);
            }
          }}
          placeholder="Paste a URL"
          autoFocus
        />
        {node.link && (
          <Button variant="secondary" size="sm" onClick={removeLink}>
            Remove link
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

const segmentedButtonGroupClass =
  "h-6 rounded-md bg-secondary gap-px [&_svg]:size-[18px]! [&>[data-slot]]:rounded-[5px]! [&>[data-slot]]:border [&>[data-slot]~[data-slot]]:border-l";

function TruncateTextIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M3.2 10.4L6 4H7.3L10.1 10.4"
        stroke="currentColor"
        strokeWidth="0.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.4 8H8.9"
        stroke="currentColor"
        strokeWidth="0.75"
        strokeLinecap="round"
      />
      <circle cx="5.2" cy="12.2" r="0.7" fill="currentColor" />
      <circle cx="8" cy="12.2" r="0.7" fill="currentColor" />
      <circle cx="10.8" cy="12.2" r="0.7" fill="currentColor" />
    </svg>
  );
}

/** One bounded slider for a single OpenType Variable Font axis (Figma-style axis control). */
function VariableAxisSlider({
  axis,
  value,
  onChange,
}: {
  axis: FontAxis;
  value: number;
  onChange: (value: number) => void;
}) {
  // A zero-width range (min === max, e.g. a font that exposes an axis with no
  // real span) has nothing to interpolate — skip rendering a disabled slider.
  if (axis.max <= axis.min) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="truncate text-[10px] font-normal text-text-muted">
        {axis.name ?? axis.tag}
      </span>
      <div className="flex min-w-0 items-center gap-2">
        <Slider
          value={value}
          min={axis.min}
          max={axis.max}
          step={1}
          getAriaLabel={() => axis.name ?? axis.tag}
          onValueChange={(next) => onChange(Array.isArray(next) ? next[0] ?? axis.default : next)}
        />
        <span className="flex h-6 w-12 shrink-0 items-center justify-end rounded-md bg-secondary px-2 text-xs leading-none tabular-nums text-secondary-foreground">
          {Math.round(value)}
        </span>
      </div>
    </div>
  );
}

export function TypographySection({ node, onUpdate }: TypographySectionProps) {
  const detachStyleFromNode = useTextStyleStore((s) => s.detachStyleFromNode);

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

  // Axis sliders only apply when the selected font is a known variable font.
  const variableFontAxes = getVariableFontAxes(node.fontFamily);
  const hasWeightAxis = variableFontAxes?.some((a) => a.tag === "wght") ?? false;

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
    // Normalize once, then map every paragraph's indentLevel directly (same
    // clamp `changeIndentLevel` applies to a single paragraph) instead of
    // calling changeIndentLevel per paragraph — that re-normalized the whole
    // (already-normalized) array on every iteration, O(n^2) for n paragraphs.
    const updated = normalizeParagraphs(node.paragraphs, paragraphCount).map((p) => ({
      ...p,
      indentLevel: Math.max(0, Math.min(MAX_INDENT_LEVEL, (p.indentLevel ?? 0) + direction)),
    }));
    onUpdate({ paragraphs: updated } as Partial<SceneNode>);
  };

  return (
    <IconContext.Provider value={{ weight: "light" }}>
      <PropertySection
        title="Typography"
        action={<TextStylesPopover node={node} />}
      >
      <PropertyRow>
        <FontCombobox
          value={node.fontFamily ?? "Arial"}
          onChange={(v) =>
            updateTypography({ fontFamily: v })
          }
        />
        {node.textStyleId && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Detach from style"
            aria-label="Detach from style"
            onClick={() => detachStyleFromNode(node.id)}
          >
            <LinkIcon />
          </Button>
        )}
      </PropertyRow>
      <PropertyRow>
        <NumberInput
          value={node.fontSize ?? 16}
          onChange={(v) =>
            updateTypography({ fontSize: v })
          }
          min={1}
        />
        {/* A "wght" axis fully covers the static fontWeight dropdown's range
            with continuous interpolation, so it replaces (rather than joins)
            it — same reasoning Figma uses for variable-font weight. */}
        {!hasWeightAxis && (
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
        )}
      </PropertyRow>
      {variableFontAxes && (
        <PropertyRow>
          <div className="flex w-full flex-col gap-2">
            {variableFontAxes.map((axis) => (
              <VariableAxisSlider
                key={axis.tag}
                axis={axis}
                value={node.fontVariations?.[axis.tag] ?? axis.default}
                onChange={(value) =>
                  updateTypography({
                    fontVariations: { ...node.fontVariations, [axis.tag]: value },
                  })
                }
              />
            ))}
          </div>
        </PropertyRow>
      )}
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
            <TextItalic className="size-[18px]!" />
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
          <LinkPopover node={node} onUpdate={onUpdate} />
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
      <PropertyRow>
        <NumberInput
          label="Paragraph Spacing"
          labelOutside={true}
          value={node.paragraphSpacing ?? 0}
          onChange={(v) =>
            updateTypography({ paragraphSpacing: v })
          }
          min={0}
          step={1}
        />
      </PropertyRow>
      </PropertySection>
    </IconContext.Provider>
  );
}
