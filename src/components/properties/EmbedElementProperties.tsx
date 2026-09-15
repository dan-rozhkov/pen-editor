import { useEffect, useState } from "react";
import { CaretLeftIcon, MinusIcon } from "@phosphor-icons/react";
import {
  findLiveEmbedElement,
  readEmbedElementSnapshot,
  applyEmbedElementEdit,
  type EmbedElementStyleSnapshot,
  type EmbedElementEdit,
} from "@/lib/embedElementStyle";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useSceneStore } from "@/store/sceneStore";
import { useReadOnly } from "@/hooks/useReadOnly";
import { IconButton } from "@/components/ui/IconButton";
import {
  ColorInput,
  NumberInput,
  PropertyRow,
  PropertySection,
  SelectInput,
  TextInput,
} from "@/components/ui/PropertyInputs";

const DISPLAY_OPTIONS = [
  { value: "block", label: "Block" },
  { value: "flex", label: "Flex" },
  { value: "inline-flex", label: "Inline flex" },
  { value: "grid", label: "Grid" },
  { value: "inline-block", label: "Inline block" },
  { value: "none", label: "None" },
];

const FLEX_DIRECTION_OPTIONS = [
  { value: "row", label: "Row" },
  { value: "column", label: "Column" },
  { value: "row-reverse", label: "Row reverse" },
  { value: "column-reverse", label: "Column reverse" },
];

const ALIGN_ITEMS_OPTIONS = [
  { value: "flex-start", label: "Start" },
  { value: "center", label: "Center" },
  { value: "flex-end", label: "End" },
  { value: "stretch", label: "Stretch" },
  { value: "baseline", label: "Baseline" },
];

const JUSTIFY_CONTENT_OPTIONS = [
  { value: "flex-start", label: "Start" },
  { value: "center", label: "Center" },
  { value: "flex-end", label: "End" },
  { value: "space-between", label: "Space between" },
  { value: "space-around", label: "Space around" },
  { value: "space-evenly", label: "Space evenly" },
];

const BORDER_STYLE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

const FONT_WEIGHT_OPTIONS = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => ({
  value: String(w),
  label: String(w),
}));

const TEXT_ALIGN_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
];

/** `display` values under which flex-only sub-properties (direction/gap/
 * align/justify) are meaningful. Grid also uses some of these keywords but
 * with different semantics (`justify-content` on a flex container behaves
 * differently from a grid one) — out of scope here, so grid only gets
 * padding, not the flex row. */
function isFlexDisplay(display: string): boolean {
  return display === "flex" || display === "inline-flex";
}

/**
 * Properties panel for a single element picked *inside* an embed's HTML
 * (via the embed element picker, `embedElementPicker.ts`/`EmbedLayer.tsx`).
 * Rendered by `PropertiesPanel` instead of the normal `PropertyEditor` while
 * `embedPickerStore.selection` points at the currently-selected embed node.
 */
export function EmbedElementProperties() {
  const readOnly = useReadOnly();
  const selection = useEmbedPickerStore((s) => s.selection);
  const clearSelection = useEmbedPickerStore((s) => s.clearSelection);
  // Selection is guaranteed non-null by the PropertiesPanel gate that
  // renders this component, but keep the hooks unconditional below by
  // deriving nullable locals instead of returning early here.
  const embedId = selection?.embedId ?? null;
  const path = selection?.path ?? null;

  const htmlContent = useSceneStore((s) =>
    embedId ? ((s.nodesById[embedId] as { htmlContent?: string } | undefined)?.htmlContent ?? null) : null,
  );

  const [snapshot, setSnapshot] = useState<EmbedElementStyleSnapshot | null>(null);
  // Distinguishes "haven't read yet" from "read, and the element genuinely
  // isn't there" — both start as `snapshot === null`, but only the second
  // should render the "element unavailable" state instead of a blank panel
  // during the first rAF tick.
  const [resolved, setResolved] = useState(false);

  // The embed re-mounts its shadow DOM in its own `useEffect` (`EmbedLayer`)
  // whenever `htmlContent` changes, and effect ordering between sibling
  // components isn't guaranteed — reading synchronously here could still see
  // the PREVIOUS shadow tree. Deferring one rAF past the commit lets that
  // mount happen first without a race-prone effect-order dependency.
  useEffect(() => {
    // Both branches defer their `setState` calls into the rAF callback
    // (rather than one running synchronously in the effect body) so the
    // lack-of-selection case can't trigger the cascading-render the
    // `react-hooks/set-state-in-effect` lint rule warns about.
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      if (!embedId || !path) {
        setSnapshot(null);
        setResolved(true);
        return;
      }
      const el = findLiveEmbedElement(embedId, path);
      setSnapshot(el ? readEmbedElementSnapshot(el) : null);
      setResolved(true);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [embedId, path, htmlContent]);

  const applyEdit = (edit: EmbedElementEdit) => {
    if (readOnly) return;
    // `embedId`/`path`/`htmlContent` are plain closure variables (this
    // function is recreated every render), so they're always current as of
    // the render that produced the event handler — no ref needed.
    if (!embedId || !path || htmlContent == null) return;
    const result = applyEmbedElementEdit(htmlContent, path, edit);
    if (!result) return;

    // Optimistic local update: NumberInput etc. call `onChange` on every
    // keystroke, and waiting for the rAF re-read above to reflect it would
    // make the field visibly lag/jump on each edit.
    setSnapshot((prev) => (prev ? applySnapshotPatch(prev, edit) : prev));

    // ORDER MATTERS: `noteSelectionEdit` must land in the store BEFORE
    // `updateNode` writes the new `htmlContent`. `useEmbedPickerLifecycle`
    // is subscribed to sceneStore synchronously and clears `selection` the
    // moment it sees `htmlContent` diverge from `selectionHtmlSnapshot` — if
    // the snapshot update lands after the scene write, that check fires
    // first and this very selection (and thus this panel) disappears mid-edit.
    useEmbedPickerStore.getState().noteSelectionEdit(result.html, result.outerHtml);
    // The picker path was built by walking the RENDERED shadow DOM, so
    // `htmlContent` (the only source of truth for an embed's markup) is the
    // right field to write the edit back to.
    useSceneStore.getState().updateNode(embedId, { htmlContent: result.html });
  };

  const writeStyles = (styles: Record<string, string | null>) => applyEdit({ styles });

  if (!selection) return null;

  const elementLabel =
    selection.tagName +
    (selection.elementId ? `#${selection.elementId}` : "") +
    (selection.classes.length > 0 ? `.${selection.classes.join(".")}` : "");

  return (
    <>
      <PropertySection
        title="Element"
        action={
          <IconButton
            tooltip="Back to embed"
            aria-label="Back to embed"
            variant="ghost"
            size="icon-sm"
            onClick={clearSelection}
          >
            <CaretLeftIcon />
          </IconButton>
        }
      >
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="text-xs font-medium text-text-primary truncate" title={elementLabel}>
            {elementLabel}
          </div>
          {selection.textPreview && (
            <div className="text-[11px] text-text-muted truncate" title={selection.textPreview}>
              {selection.textPreview}
            </div>
          )}
        </div>
      </PropertySection>

      {!resolved ? null : !snapshot ? (
        <div className="px-4 py-3 text-[11px] text-text-muted">
          Element unavailable — it may no longer exist in this embed.
        </div>
      ) : (
        <ElementPropertyFields snapshot={snapshot} onWriteStyles={writeStyles} onApplyEdit={applyEdit} />
      )}
    </>
  );
}

/** Apply the same edit we just sent to `applyEmbedElementEdit` to the local
 * snapshot, so the panel reflects it immediately instead of waiting for the
 * rAF re-read. Deliberately narrow: only touches the fields the panel's own
 * editors can produce edits for. */
function applySnapshotPatch(
  prev: EmbedElementStyleSnapshot,
  edit: EmbedElementEdit,
): EmbedElementStyleSnapshot {
  const next = { ...prev };
  if (edit.text !== undefined) next.text = edit.text;
  if (edit.styles) {
    for (const [prop, value] of Object.entries(edit.styles)) {
      patchSnapshotStyle(next, prop, value);
    }
  }
  return next;
}

function patchSnapshotStyle(
  snap: EmbedElementStyleSnapshot,
  prop: string,
  value: string | null,
): void {
  const num = (v: string | null) => (v == null || v === "" ? 0 : Number.parseFloat(v)) || 0;
  switch (prop) {
    case "width":
      snap.width = num(value);
      break;
    case "height":
      snap.height = num(value);
      break;
    case "display":
      snap.display = value ?? "block";
      break;
    case "flex-direction":
      snap.flexDirection = value ?? "row";
      break;
    case "gap":
      snap.gap = num(value);
      break;
    case "align-items":
      snap.alignItems = value ?? "";
      break;
    case "justify-content":
      snap.justifyContent = value ?? "";
      break;
    case "padding-top":
      snap.padding = { ...snap.padding, top: num(value) };
      break;
    case "padding-right":
      snap.padding = { ...snap.padding, right: num(value) };
      break;
    case "padding-bottom":
      snap.padding = { ...snap.padding, bottom: num(value) };
      break;
    case "padding-left":
      snap.padding = { ...snap.padding, left: num(value) };
      break;
    case "opacity":
      snap.opacity = value == null || value === "" ? 1 : Number.parseFloat(value);
      break;
    case "border-radius":
      snap.borderRadius = num(value);
      break;
    case "background-color":
      snap.backgroundColor = value ?? "";
      break;
    case "border-width":
      snap.borderWidth = num(value);
      break;
    case "border-color":
      snap.borderColor = value ?? "";
      break;
    case "border-style":
      snap.borderStyle = value ?? "none";
      break;
    case "font-size":
      snap.fontSize = num(value);
      break;
    case "font-weight":
      snap.fontWeight = num(value) || 400;
      break;
    case "line-height":
      // "normal" is what the Line field writes for 0 — parseFloat gives NaN,
      // and `num` maps that back to 0, which is the field's own "unset" value.
      snap.lineHeight = num(value);
      break;
    case "letter-spacing":
      snap.letterSpacing = num(value);
      break;
    case "text-align":
      snap.textAlign = value ?? "left";
      break;
    case "color":
      snap.color = value ?? "";
      break;
    default:
      break;
  }
}

interface FieldsProps {
  snapshot: EmbedElementStyleSnapshot;
  onWriteStyles: (styles: Record<string, string | null>) => void;
  onApplyEdit: (edit: EmbedElementEdit) => void;
}

/**
 * Every control writes an EXPLICIT declaration, never `null` ("remove the
 * inline declaration"), even when the chosen value happens to be the CSS
 * initial one. Embed HTML styles almost everything through classes, so
 * removing an inline declaration that was never there is a no-op: typing 0
 * into Pad T on a `.row { padding: 16px }` element would leave the 16px in
 * place and the field would snap back on the next re-read, with the control
 * appearing to do nothing. An explicit `padding-top: 0px` actually overrides
 * the class. The one deliberate removal left is the Fill section's explicit
 * "Remove" action.
 */
function ElementPropertyFields({ snapshot, onWriteStyles, onApplyEdit }: FieldsProps) {
  const flexy = isFlexDisplay(snapshot.display);

  const setBorder = (patch: { width?: number; color?: string; style?: string }) => {
    const nextWidth = patch.width ?? snapshot.borderWidth;
    const nextColor = patch.color ?? snapshot.borderColor;
    let nextStyle = patch.style ?? snapshot.borderStyle;
    // A non-zero width or a set color with `border-style: none` renders
    // nothing — nudge the style to `solid` so the change is actually visible,
    // mirroring how the native Stroke section always implies a paint style.
    if (nextStyle === "none" && (nextWidth > 0 || nextColor)) {
      nextStyle = "solid";
    }
    // Write ONLY the longhand the user actually touched. Sending the others
    // as `null` would `removeProperty` them — and removing one longhand also
    // tears it out of an existing `border: 2px solid #333` shorthand, so
    // picking a new stroke colour would silently delete the element's width.
    const styles: Record<string, string | null> = {};
    if (patch.width !== undefined) styles["border-width"] = `${patch.width}px`;
    if (patch.color !== undefined) styles["border-color"] = patch.color || null;
    if (patch.style !== undefined || nextStyle !== snapshot.borderStyle) {
      styles["border-style"] = nextStyle;
    }
    onWriteStyles(styles);
  };

  return (
    <>
      <PropertySection title="Size">
        <PropertyRow>
          <NumberInput
            label="W"
            value={snapshot.width}
            onChange={(v) => onWriteStyles({ width: `${v}px` })}
            min={0}
          />
          <NumberInput
            label="H"
            value={snapshot.height}
            onChange={(v) => onWriteStyles({ height: `${v}px` })}
            min={0}
          />
        </PropertyRow>
      </PropertySection>

      <PropertySection title="Layout">
        <PropertyRow>
          <SelectInput
            label="Display"
            labelOutside
            value={snapshot.display}
            options={DISPLAY_OPTIONS}
            onChange={(v) => onWriteStyles({ display: v })}
          />
        </PropertyRow>
        {flexy && (
          <>
            <PropertyRow>
              <SelectInput
                label="Direction"
                labelOutside
                value={snapshot.flexDirection}
                options={FLEX_DIRECTION_OPTIONS}
                onChange={(v) => onWriteStyles({ "flex-direction": v })}
              />
              <NumberInput
                label="Gap"
                value={snapshot.gap}
                onChange={(v) => onWriteStyles({ gap: `${v}px` })}
                min={0}
                labelOutside
              />
            </PropertyRow>
            <PropertyRow>
              <SelectInput
                label="Align"
                labelOutside
                value={snapshot.alignItems}
                options={ALIGN_ITEMS_OPTIONS}
                onChange={(v) => onWriteStyles({ "align-items": v })}
              />
              <SelectInput
                label="Justify"
                labelOutside
                value={snapshot.justifyContent}
                options={JUSTIFY_CONTENT_OPTIONS}
                onChange={(v) => onWriteStyles({ "justify-content": v })}
              />
            </PropertyRow>
          </>
        )}
        <div className="mt-2 text-[10px] font-normal text-text-muted">Padding</div>
        <PropertyRow>
          <NumberInput
            label="T"
            value={snapshot.padding.top}
            onChange={(v) => onWriteStyles({ "padding-top": `${v}px` })}
            min={0}
          />
          <NumberInput
            label="R"
            value={snapshot.padding.right}
            onChange={(v) => onWriteStyles({ "padding-right": `${v}px` })}
            min={0}
          />
        </PropertyRow>
        <PropertyRow>
          <NumberInput
            label="B"
            value={snapshot.padding.bottom}
            onChange={(v) => onWriteStyles({ "padding-bottom": `${v}px` })}
            min={0}
          />
          <NumberInput
            label="L"
            value={snapshot.padding.left}
            onChange={(v) => onWriteStyles({ "padding-left": `${v}px` })}
            min={0}
          />
        </PropertyRow>
      </PropertySection>

      <PropertySection title="Appearance">
        <PropertyRow>
          <NumberInput
            label="Opacity %"
            value={Math.round(snapshot.opacity * 100)}
            onChange={(v) => onWriteStyles({ opacity: String(Math.max(0, Math.min(100, v)) / 100) })}
            min={0}
            max={100}
            labelOutside
          />
          <NumberInput
            label="Radius"
            value={snapshot.borderRadius}
            onChange={(v) => onWriteStyles({ "border-radius": `${v}px` })}
            min={0}
            labelOutside
          />
        </PropertyRow>
      </PropertySection>

      <PropertySection
        title="Fill"
        action={
          snapshot.backgroundColor ? (
            <IconButton
              tooltip="Remove fill"
              aria-label="Remove fill"
              variant="ghost"
              size="icon-sm"
              onClick={() => onWriteStyles({ "background-color": null })}
            >
              <MinusIcon />
            </IconButton>
          ) : undefined
        }
      >
        <div className="[&>div]:w-full">
          <ColorInput
            value={snapshot.backgroundColor}
            onChange={(v) => onWriteStyles({ "background-color": v })}
          />
        </div>
      </PropertySection>

      <PropertySection title="Stroke">
        <PropertyRow>
          <NumberInput
            label="W"
            value={snapshot.borderWidth}
            onChange={(v) => setBorder({ width: v })}
            min={0}
            labelOutside
          />
          <SelectInput
            label="Style"
            labelOutside
            value={snapshot.borderStyle}
            options={BORDER_STYLE_OPTIONS}
            onChange={(v) => setBorder({ style: v })}
          />
        </PropertyRow>
        <div className="[&>div]:w-full">
          <ColorInput value={snapshot.borderColor} onChange={(v) => setBorder({ color: v })} />
        </div>
      </PropertySection>

      <PropertySection title="Typography">
        <PropertyRow>
          <NumberInput
            label="Size"
            value={snapshot.fontSize}
            onChange={(v) => onWriteStyles({ "font-size": `${v}px` })}
            min={0}
            labelOutside
          />
          <SelectInput
            label="Weight"
            labelOutside
            value={String(snapshot.fontWeight)}
            options={FONT_WEIGHT_OPTIONS}
            onChange={(v) => onWriteStyles({ "font-weight": v })}
          />
        </PropertyRow>
        <PropertyRow>
          <NumberInput
            label="Line height"
            value={snapshot.lineHeight}
            onChange={(v) => onWriteStyles({ "line-height": v ? `${v}px` : "normal" })}
            min={0}
            labelOutside
          />
          <NumberInput
            label="Letter spacing"
            value={snapshot.letterSpacing}
            onChange={(v) => onWriteStyles({ "letter-spacing": `${v}px` })}
            labelOutside
          />
        </PropertyRow>
        <PropertyRow>
          <SelectInput
            label="Align"
            labelOutside
            value={snapshot.textAlign}
            options={TEXT_ALIGN_OPTIONS}
            onChange={(v) => onWriteStyles({ "text-align": v })}
          />
        </PropertyRow>
        <div className="[&>div]:w-full">
          <ColorInput value={snapshot.color} onChange={(v) => onWriteStyles({ color: v })} />
        </div>
      </PropertySection>

      {snapshot.text !== null && (
        <PropertySection title="Text">
          <TextInput value={snapshot.text} onChange={(text) => onApplyEdit({ text })} />
        </PropertySection>
      )}
    </>
  );
}
