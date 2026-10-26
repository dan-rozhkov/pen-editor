import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  AlignBottomIcon,
  AlignCenterVerticalIcon,
  AlignTopIcon,
  ArrowsOutIcon,
  ArrowLineRightIcon,
  ArticleIcon,
  CheckIcon,
  LinkIcon,
  LinkSimpleIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  NumberZeroIcon,
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextIndentIcon,
  TextItalicIcon,
  TextOutdentIcon,
  TextAaIcon,
  TextStrikethroughIcon,
  TextSuperscriptIcon,
  TextTIcon,
  TextUnderlineIcon,
  XIcon,
  IconContext,
} from "@/components/icons";
import type { SceneNode, TextNode } from "@/types/scene";
import type { ThemeName, Variable } from "@/types/variable";
import {
  ColorInput,
  NumberInput,
  PropertyRow,
  PropertySection,
  SelectInput,
} from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { SegmentedGroup, segmentedActionClass, segmentedItemClass } from "@/components/ui/segmented-control";
import { FontCombobox } from "@/components/ui/FontCombobox";
import { FontUploadButton } from "@/components/ui/FontUploadButton";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTextStyleStore } from "@/store/textStyleStore";
import { TEXT_STYLE_PROPERTY_KEYS, type TextStyle } from "@/types/textStyle";
import { MAX_INDENT_LEVEL, getParagraphAttrs, normalizeParagraphs, splitParagraphs } from "@/lib/textLists/paragraphs";
import { toggleListType } from "@/lib/textLists/listEditing";
import { isTypingTarget } from "@/components/canvas/keyboardShortcutUtils";
import { Slider } from "@/components/ui/slider";
import { useReadOnly } from "@/hooks/useReadOnly";
import { getVariableFontAxes, type FontAxis } from "@/utils/variableFont";
import {
  OPEN_TYPE_TOGGLE_FEATURES,
  OPEN_TYPE_SELECT_GROUPS,
  withToggleFeature,
  getGroupSelection,
  withGroupSelection,
  type OpenTypeSelectGroup,
} from "@/utils/openTypeFeatures";
import { layoutTextOnPath } from "@/utils/textPathLayout";
import { useSelectionStore } from "@/store/selectionStore";
import { enterTextPathEditMode } from "@/pixi/interaction/pathEditMode";

/** True when one or more trailing characters don't fit before the path's end (see `layoutTextOnPath`'s overflow policy doc comment). */
function textPathOverflows(node: TextNode): boolean {
  return layoutTextOnPath(node)?.overflow ?? false;
}

interface TypographySectionProps {
  node: TextNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
  /**
   * The node passed in isn't backed by a real entry in `nodesById` (e.g. a
   * synthetic node built from an embed's computed style). Text-style
   * apply/create/detach (`TextStylesPopover`'s `applyStyleToNode`/
   * `createStyleFromNode`, and this component's own `detachStyleFromNode`)
   * write to `useTextStyleStore` by `node.id` directly, bypassing `onUpdate`
   * — for a detached node that's either a silent no-op or a write to
   * whatever unrelated real node happens to share that id. Hides the text
   * styles popover and the detach button; every other control here is
   * unaffected since it goes through `onUpdate`/`updateTypography`. Used by
   * the embed-element properties panel.
   */
  detachedNode?: boolean;
  /**
   * Hide the List (bullet/number, indent/outdent) row and the whole Path
   * section. Both need real markup/geometry a plain inline-CSS edit of an
   * existing HTML element can't produce: lists rewrite the node's paragraphs
   * into nested `<ul>`/`<ol>` markup at HTML-generation time
   * (`convertNode.ts`'s paragraph serialization) rather than a style
   * property, and text-on-a-path has no CSS equivalent at all and is
   * dropped entirely on export (`convertNode.ts`'s documented degradation) —
   * its "Edit Path" button is also Pixi-canvas-only
   * (`enterTextPathEditMode`/`useSelectionStore`), which doesn't exist
   * without a real Pixi node either. Used by the embed-element properties
   * panel.
   */
  hideStructuralText?: boolean;
  /**
   * Renders a trailing text-color row, wired exactly like `FillSection`'s/
   * `StrokeSection`'s own solid-color rows (same `ColorInput`, same
   * value/onChange/variable-binding shape). Absent by default, so the
   * native panel — where a real `TextNode`'s color already lives in
   * `FillSection`, and this section has no color control at all — renders
   * byte-identical.
   *
   * This is the ONE deliberate content difference from the native panel,
   * used solely by the embed-element properties panel: its synthetic node
   * is always `type: "frame"` (`embedElementNode.ts`), so `FillSection`
   * there means the element's BACKGROUND, leaving text color with nowhere
   * else to go. Passed as a self-contained `{value, onChange, ...}` bundle —
   * mirroring `ColorInput`'s own prop shape — rather than threaded through
   * `onUpdate`/`node.fill`: `onUpdate` here is typed `Partial<SceneNode>`,
   * and the underlying field (`SyntheticNodeShape.textFill`) doesn't exist
   * on a real `SceneNode`, so routing it through `onUpdate` would need an
   * unsafe cast at the call site instead of a plain, typed callback.
   */
  textColor?: {
    value: string;
    onChange: (value: string) => void;
    variableId?: string;
    onVariableChange: (variableId: string | undefined) => void;
    colorVariables: Variable[];
    activeTheme: ThemeName;
  };
}

const STYLE_MANAGED_KEYS: readonly string[] = TEXT_STYLE_PROPERTY_KEYS;
const TYPOGRAPHY_POPOVER_PANEL_OFFSET = 252;
/** `SelectInput` only accepts string values — this sentinel stands in for an `OpenTypeSelectGroup`'s "default/none" (`tag: null`) option. */
const OPEN_TYPE_GROUP_DEFAULT_VALUE = "__default__";

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
      <PopoverTrigger
        render={
          <IconButton variant="ghost" size="icon-sm" tooltip="Text styles">
            <PlusIcon />
          </IconButton>
        }
      />
      <PopoverContent
        side="left"
        align="start"
        sideOffset={TYPOGRAPHY_POPOVER_PANEL_OFFSET}
        className="w-[240px] max-h-[360px] gap-0 overflow-hidden p-0"
        draggable
        dragHandleContent={<span className="text-[11px] font-semibold text-text-primary">Text styles</span>}
      >
        <div className="flex h-10 items-center justify-between border-b border-input px-3">
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="flex size-6 items-center justify-center rounded-md text-text-primary hover:bg-secondary"
                    aria-label="Create text style"
                    onClick={() => createStyleFromNode(node.id, node.name || "New text style")}
                  >
                    <PlusIcon size={14} />
                  </button>
                }
              />
              <TooltipContent>
                <span>Create text style</span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="flex size-6 items-center justify-center rounded-md text-text-primary hover:bg-secondary"
                    aria-label="Close text styles"
                    onClick={() => setOpen(false)}
                  >
                    <XIcon size={14} />
                  </button>
                }
              />
              <TooltipContent>
                <span>Close</span>
              </TooltipContent>
            </Tooltip>
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
      // Stop the event before it reaches the command palette's bubble-phase
      // ⌘K listener — while a text node is selected, ⌘K inserts a link
      // (contextual) rather than also opening the palette.
      e.stopPropagation();
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
      <PopoverTrigger
        render={
          <IconButton
            variant={node.link ? "default" : "ghost"}
            size="icon-sm"
            tooltip="Link (⌘K)"
            aria-label="Link"
            className={
              node.link
                ? "border-border-default bg-surface-panel text-text-primary shadow-none hover:bg-surface-panel"
                : ""
            }
          >
            <LinkSimpleIcon />
          </IconButton>
        }
      />
      <PopoverContent
        side="left"
        align="start"
        sideOffset={TYPOGRAPHY_POPOVER_PANEL_OFFSET}
        className="w-[240px] gap-2"
        draggable
        dragHandleContent={<span className="text-[11px] font-semibold text-text-primary">Link</span>}
      >
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

function TruncateTextIcon() {
  return (
    <svg
      aria-hidden="true"
      data-pen-icon="TruncateText"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 10 8 2.5l3.5 7.5" />
      <path d="M6.2 7.5h3.6" />
      <circle cx="4" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="13" r="1" fill="currentColor" stroke="none" />
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

/** One compact select for a mutually-exclusive numeral OpenType group. */
function OpenTypeGroupSelect({
  group,
  fontFeatures,
  onChange,
}: {
  group: OpenTypeSelectGroup;
  fontFeatures: Record<string, number> | undefined;
  onChange: (features: Record<string, number>) => void;
}) {
  const value = getGroupSelection(fontFeatures, group) ?? OPEN_TYPE_GROUP_DEFAULT_VALUE;
  return (
    <SelectInput
      label={group.label}
      labelOutside
      value={value}
      options={group.options.map((option) => ({
        value: option.tag ?? OPEN_TYPE_GROUP_DEFAULT_VALUE,
        label: option.label,
      }))}
      onChange={(next) => {
        const tag = next === OPEN_TYPE_GROUP_DEFAULT_VALUE ? null : next;
        onChange(withGroupSelection(fontFeatures, group, tag));
      }}
    />
  );
}

function OpenTypeToggleIcon({ tag }: { tag: string }) {
  switch (tag) {
    case "smcp":
      return <TextTIcon />;
    case "frac":
      return <TextSuperscriptIcon />;
    case "zero":
      return <NumberZeroIcon />;
    default:
      return <TextAaIcon />;
  }
}

/** Advanced OpenType controls, kept out of the main inspector until needed. */
function OpenTypePopover({
  node,
  onUpdate,
}: {
  node: TextNode;
  onUpdate: (updates: Partial<TextNode>) => void;
}) {
  const readOnly = useReadOnly();
  const variableFontAxes = getVariableFontAxes(node.fontFamily);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <IconButton
            variant="ghost"
            size="icon-sm"
            tooltip="OpenType settings"
            aria-label="OpenType settings"
          >
            <SlidersHorizontalIcon />
          </IconButton>
        }
      />
      <PopoverContent
        side="left"
        align="start"
        sideOffset={TYPOGRAPHY_POPOVER_PANEL_OFFSET}
        className="w-[272px] gap-3"
        draggable
        dragHandleContent={<span className="text-[11px] font-semibold text-text-primary">OpenType</span>}
      >
        {variableFontAxes && (
          <div className="flex flex-col gap-2">
            {variableFontAxes.map((axis) => (
              <VariableAxisSlider
                key={axis.tag}
                axis={axis}
                value={node.fontVariations?.[axis.tag] ?? axis.default}
                onChange={(value) =>
                  onUpdate({
                    fontVariations: { ...node.fontVariations, [axis.tag]: value },
                  })
                }
              />
            ))}
          </div>
        )}
        <SegmentedGroup className="w-full" aria-label="OpenType features">
          {OPEN_TYPE_TOGGLE_FEATURES.map((feature) => (
            <IconButton
              key={feature.tag}
              variant="ghost"
              size="icon-sm"
              tooltip={feature.label}
              aria-label={feature.label}
              aria-pressed={node.fontFeatures?.[feature.tag] === 1}
              disabled={readOnly}
              className={segmentedItemClass(node.fontFeatures?.[feature.tag] === 1, { icon: true, className: "flex-1" })}
              onClick={() =>
                onUpdate({
                  fontFeatures: withToggleFeature(
                    node.fontFeatures,
                    feature.tag,
                    node.fontFeatures?.[feature.tag] !== 1,
                  ),
                })
              }
            >
              <OpenTypeToggleIcon tag={feature.tag} />
            </IconButton>
          ))}
        </SegmentedGroup>
        <div className="flex flex-col gap-3">
          {OPEN_TYPE_SELECT_GROUPS.map((group) => (
            <OpenTypeGroupSelect
              key={group.key}
              group={group}
              fontFeatures={node.fontFeatures}
              onChange={(fontFeatures) => onUpdate({ fontFeatures })}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TypographySection({
  node,
  onUpdate,
  detachedNode = false,
  hideStructuralText = false,
  textColor,
}: TypographySectionProps) {
  const detachStyleFromNode = useTextStyleStore((s) => s.detachStyleFromNode);
  const isEditingPath = useSelectionStore(
    (s) => s.editingNodeId === node.id && s.editingMode === "text-path",
  );
  const stopEditing = useSelectionStore((s) => s.stopEditing);

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
        action={
          <div className="flex items-center gap-1">
            <FontUploadButton
              onUploaded={(family) => updateTypography({ fontFamily: family })}
            />
            {!detachedNode && <TextStylesPopover node={node} />}
          </div>
        }
      >
      <PropertyRow>
        <FontCombobox
          value={node.fontFamily ?? "Arial"}
          onChange={(v) =>
            updateTypography({ fontFamily: v })
          }
        />
        {node.textStyleId && !detachedNode && (
          <IconButton
            variant="ghost"
            size="icon-sm"
            tooltip="Detach from style"
            onClick={() => detachStyleFromNode(node.id)}
          >
            <LinkIcon />
          </IconButton>
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
      <PropertyRow>
        <div className="flex items-center gap-1 flex-1">
          <SegmentedGroup className="flex-1" aria-label="Text style">
            <IconButton
              variant="ghost"
              size="sm"
              tooltip="Italic"
              aria-label="Italic"
              aria-pressed={node.fontStyle === "italic"}
              className={segmentedItemClass(node.fontStyle === "italic", { icon: true, className: "flex-1" })}
              onClick={() =>
                onUpdate({
                  fontStyle:
                    node.fontStyle === "italic" ? "normal" : "italic",
                } as Partial<SceneNode>)
              }
            >
              <TextItalicIcon size={14} />
            </IconButton>
            <IconButton
              variant="ghost"
              size="sm"
              tooltip="Underline"
              aria-pressed={!!node.underline}
              className={segmentedItemClass(node.underline, { icon: true, className: "flex-1" })}
              onClick={() =>
                onUpdate({
                  underline: !node.underline,
                } as Partial<SceneNode>)
              }
            >
              <TextUnderlineIcon size={14} />
            </IconButton>
            <IconButton
              variant="ghost"
              size="sm"
              tooltip="Strikethrough"
              aria-pressed={!!node.strikethrough}
              className={segmentedItemClass(node.strikethrough, { icon: true, className: "flex-1" })}
              onClick={() =>
                onUpdate({
                  strikethrough: !node.strikethrough,
                } as Partial<SceneNode>)
              }
            >
              <TextStrikethroughIcon size={14} />
            </IconButton>
          </SegmentedGroup>
          <LinkPopover node={node} onUpdate={onUpdate} />
          <OpenTypePopover node={node} onUpdate={updateTypography} />
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
            <SegmentedGroup className="flex-1" aria-label="Text alignment">
              <IconButton
                variant="ghost"
                size="sm"
                tooltip="Align left"
                aria-pressed={node.textAlign === "left"}
                className={segmentedItemClass(node.textAlign === "left", { icon: true, className: "flex-1" })}
                onClick={() =>
                  onUpdate({ textAlign: "left" } as Partial<SceneNode>)
                }
              >
                <TextAlignLeftIcon size={14} />
              </IconButton>
              <IconButton
                variant="ghost"
                size="sm"
                tooltip="Align center"
                aria-pressed={node.textAlign === "center"}
                className={segmentedItemClass(node.textAlign === "center", { icon: true, className: "flex-1" })}
                onClick={() =>
                  onUpdate({ textAlign: "center" } as Partial<SceneNode>)
                }
              >
                <TextAlignCenterIcon size={14} />
              </IconButton>
              <IconButton
                variant="ghost"
                size="sm"
                tooltip="Align right"
                aria-pressed={node.textAlign === "right"}
                className={segmentedItemClass(node.textAlign === "right", { icon: true, className: "flex-1" })}
                onClick={() =>
                  onUpdate({ textAlign: "right" } as Partial<SceneNode>)
                }
              >
                <TextAlignRightIcon size={14} />
              </IconButton>
            </SegmentedGroup>
          </div>
          <div className="flex items-center gap-1 flex-1">
            <SegmentedGroup className="flex-1" aria-label="Vertical alignment">
              <IconButton
                variant="ghost"
                size="sm"
                tooltip="Align top"
                aria-pressed={node.textAlignVertical === "top"}
                className={segmentedItemClass(node.textAlignVertical === "top", { icon: true, className: "flex-1" })}
                onClick={() =>
                  onUpdate({
                    textAlignVertical: "top",
                  } as Partial<SceneNode>)
                }
              >
                <AlignTopIcon size={14} />
              </IconButton>
              <IconButton
                variant="ghost"
                size="sm"
                tooltip="Align middle"
                aria-pressed={node.textAlignVertical === "middle"}
                className={segmentedItemClass(node.textAlignVertical === "middle", { icon: true, className: "flex-1" })}
                onClick={() =>
                  onUpdate({
                    textAlignVertical: "middle",
                  } as Partial<SceneNode>)
                }
              >
                <AlignCenterVerticalIcon size={14} />
              </IconButton>
              <IconButton
                variant="ghost"
                size="sm"
                tooltip="Align bottom"
                aria-pressed={node.textAlignVertical === "bottom"}
                className={segmentedItemClass(node.textAlignVertical === "bottom", { icon: true, className: "flex-1" })}
                onClick={() =>
                  onUpdate({
                    textAlignVertical: "bottom",
                  } as Partial<SceneNode>)
                }
              >
                <AlignBottomIcon size={14} />
              </IconButton>
            </SegmentedGroup>
          </div>
        </PropertyRow>
      </div>
      {!hideStructuralText && (
      <div className="flex flex-col gap-1">
        <div className="text-[10px] font-normal text-text-muted">
          List
        </div>
        <PropertyRow>
          <div className="flex items-center gap-1 flex-1">
            <SegmentedGroup className="flex-1" aria-label="List type">
              <IconButton
                variant="ghost"
                size="sm"
                tooltip="Bulleted list (⌘⇧8)"
                aria-label="Bulleted list"
                aria-pressed={firstParagraphAttrs.listType === "bullet"}
                className={segmentedItemClass(firstParagraphAttrs.listType === "bullet", { icon: true, className: "flex-1" })}
                onClick={() => applyListType("bullet")}
              >
                <ListBulletsIcon size={14} />
              </IconButton>
              <IconButton
                variant="ghost"
                size="sm"
                tooltip="Numbered list (⌘⇧7)"
                aria-label="Numbered list"
                aria-pressed={firstParagraphAttrs.listType === "number"}
                className={segmentedItemClass(firstParagraphAttrs.listType === "number", { icon: true, className: "flex-1" })}
                onClick={() => applyListType("number")}
              >
                <ListNumbersIcon size={14} />
              </IconButton>
            </SegmentedGroup>
          </div>
          <div className="flex items-center gap-1 flex-1">
            <SegmentedGroup className="flex-1" aria-label="List indent">
              <IconButton
                variant="ghost"
                size="sm"
                tooltip="Outdent (Shift+Tab)"
                aria-label="Outdent"
                className={segmentedActionClass({ icon: true, className: "flex-1" })}
                onClick={() => applyIndent(-1)}
              >
                <TextOutdentIcon size={14} />
              </IconButton>
              <IconButton
                variant="ghost"
                size="sm"
                tooltip="Indent (Tab)"
                aria-label="Indent"
                className={segmentedActionClass({ icon: true, className: "flex-1" })}
                onClick={() => applyIndent(1)}
              >
                <TextIndentIcon size={14} />
              </IconButton>
            </SegmentedGroup>
          </div>
        </PropertyRow>
      </div>
      )}
      <div className="flex flex-col gap-1">
        <div className="text-[10px] font-normal text-text-muted">
          Resizing
        </div>
        <SegmentedGroup className="w-full" aria-label="Resizing">
          <IconButton
            variant="ghost"
            size="sm"
            tooltip="Auto width"
            aria-label="Auto width"
            aria-pressed={node.textWidthMode === "auto"}
            className={segmentedItemClass(node.textWidthMode === "auto", { icon: true, className: "flex-1" })}
            onClick={() => setTextWidthMode("auto")}
          >
            <ArrowsOutIcon size={14} />
          </IconButton>
          <IconButton
            variant="ghost"
            size="sm"
            tooltip="Fixed width"
            aria-label="Fixed width"
            aria-pressed={node.textWidthMode === "fixed"}
            className={segmentedItemClass(node.textWidthMode === "fixed", { icon: true, className: "flex-1" })}
            onClick={() => setTextWidthMode("fixed")}
          >
            <ArrowLineRightIcon size={14} />
          </IconButton>
          <IconButton
            variant="ghost"
            size="sm"
            tooltip="Fixed size"
            aria-label="Fixed size"
            aria-pressed={node.textWidthMode === "fixed-height"}
            className={segmentedItemClass(node.textWidthMode === "fixed-height", { icon: true, className: "flex-1" })}
            onClick={() => setTextWidthMode("fixed-height")}
          >
            <ArticleIcon size={14} />
          </IconButton>
        </SegmentedGroup>
      </div>
      {isWrapped && (
        <PropertyRow>
          <div className="flex flex-1 flex-col gap-1">
            <div className="text-[10px] font-normal text-text-muted">
              Truncate text
            </div>
            <SegmentedGroup className="w-full" aria-label="Truncate text">
              <IconButton
                variant="ghost"
                size="sm"
                tooltip="No truncation"
                aria-label="No truncation"
                aria-pressed={!node.truncateText}
                className={segmentedItemClass(!node.truncateText, { icon: true, className: "flex-1" })}
                onClick={() =>
                  onUpdate({
                    truncateText: false,
                  } as Partial<SceneNode>)
                }
              >
                <MinusIcon size={14} />
              </IconButton>
              <IconButton
                variant="ghost"
                size="sm"
                tooltip="Truncate with ellipsis"
                aria-label="Truncate with ellipsis"
                aria-pressed={!!node.truncateText}
                className={segmentedItemClass(node.truncateText, { icon: true, className: "flex-1" })}
                onClick={() =>
                  onUpdate({
                    truncateText: true,
                  } as Partial<SceneNode>)
                }
              >
                <TruncateTextIcon />
              </IconButton>
            </SegmentedGroup>
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
      {node.textPath && !hideStructuralText && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-normal text-text-muted">
              Path
            </div>
            <Button
              variant={isEditingPath ? "default" : "secondary"}
              size="sm"
              aria-pressed={isEditingPath}
              onClick={() =>
                isEditingPath ? stopEditing() : enterTextPathEditMode(node.id)
              }
            >
              {isEditingPath ? "Done" : "Edit Path"}
            </Button>
          </div>
          <PropertyRow>
            <NumberInput
              label="Offset"
              labelOutside={true}
              value={Math.round((node.textPath.startOffset ?? 0) * 100)}
              onChange={(v) =>
                onUpdate({
                  textPath: {
                    ...node.textPath!,
                    startOffset: Math.max(0, Math.min(100, v)) / 100,
                  },
                } as Partial<SceneNode>)
              }
              min={0}
              max={100}
              step={1}
            />
            <div className="flex items-center gap-1 flex-1">
              <SegmentedGroup className="flex-1" aria-label="Path direction">
                <IconButton
                  variant="ghost"
                  size="sm"
                  tooltip="Flip text orientation"
                  aria-label="Flip text orientation off"
                  aria-pressed={!node.textPath.flip}
                  className={segmentedItemClass(!node.textPath.flip, { icon: true, className: "flex-1" })}
                  onClick={() =>
                    onUpdate({
                      textPath: { ...node.textPath!, flip: false },
                    } as Partial<SceneNode>)
                  }
                >
                  <ArrowLineRightIcon size={14} />
                </IconButton>
                <IconButton
                  variant="ghost"
                  size="sm"
                  tooltip="Flip text to the other side of the path"
                  aria-label="Flip text orientation on"
                  aria-pressed={!!node.textPath.flip}
                  className={segmentedItemClass(node.textPath.flip, { icon: true, className: "flex-1" })}
                  onClick={() =>
                    onUpdate({
                      textPath: { ...node.textPath!, flip: true },
                    } as Partial<SceneNode>)
                  }
                >
                  <ArrowLineRightIcon size={14} className="-scale-x-100" />
                </IconButton>
              </SegmentedGroup>
            </div>
          </PropertyRow>
          <PropertyRow>
            <div className="flex flex-1 flex-col gap-1">
              <div className="text-[10px] font-normal text-text-muted">
                Side
              </div>
              <SegmentedGroup className="w-full" aria-label="Path side">
                <IconButton
                  variant="ghost"
                  size="sm"
                  tooltip="Text above the path"
                  aria-label="Text above the path"
                  aria-pressed={node.textPath.side === "left"}
                  className={segmentedItemClass(node.textPath.side === "left", { icon: true, className: "flex-1" })}
                  onClick={() =>
                    onUpdate({
                      textPath: { ...node.textPath!, side: "left" },
                    } as Partial<SceneNode>)
                  }
                >
                  <AlignTopIcon size={14} />
                </IconButton>
                <IconButton
                  variant="ghost"
                  size="sm"
                  tooltip="Text below the path"
                  aria-label="Text below the path"
                  aria-pressed={node.textPath.side === "right"}
                  className={segmentedItemClass(node.textPath.side === "right", { icon: true, className: "flex-1" })}
                  onClick={() =>
                    onUpdate({
                      textPath: { ...node.textPath!, side: "right" },
                    } as Partial<SceneNode>)
                  }
                >
                  <AlignBottomIcon size={14} />
                </IconButton>
              </SegmentedGroup>
            </div>
          </PropertyRow>
          {textPathOverflows(node) && (
            <PropertyRow>
              <div className="flex items-center gap-1 text-[10px] font-normal text-text-muted">
                Text overflows the end of the path and is clipped.
              </div>
            </PropertyRow>
          )}
        </div>
      )}
      {textColor && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] font-normal text-text-muted">
            Color
          </div>
          <ColorInput
            value={textColor.value}
            onChange={textColor.onChange}
            variableId={textColor.variableId}
            onVariableChange={textColor.onVariableChange}
            availableVariables={textColor.colorVariables}
            activeTheme={textColor.activeTheme}
          />
        </div>
      )}
      </PropertySection>
    </IconContext.Provider>
  );
}
