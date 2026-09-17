import { useCallback, useEffect, useMemo, useState } from "react";
import { CaretLeftIcon, PencilSimpleLineIcon } from "@phosphor-icons/react";
import {
  embedElementToSyntheticNode,
  syntheticNodeToCssDeclarations,
  diffCssDeclarations,
  type SyntheticNodeShape,
} from "@/lib/embedElementNode";
import { findLiveEmbedElement, applyEmbedElementEdit } from "@/lib/embedElementStyle";
import { BACKGROUND_STYLE_KEYS } from "@/lib/designToHtml/styleGeneration";
import { getFills } from "@/utils/fillUtils";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { getThemeFromAncestorFrames, type FlatParentContext } from "@/utils/nodeUtils";
import { useReadOnly } from "@/hooks/useReadOnly";
import { IconButton } from "@/components/ui/IconButton";
import { PropertySection, TextInput } from "@/components/ui/PropertyInputs";
import { SizeSection } from "@/components/properties/SizeSection";
import { AutoLayoutSection } from "@/components/properties/AutoLayoutSection";
import { AppearanceSection } from "@/components/properties/AppearanceSection";
import { FillSection } from "@/components/properties/FillSection";
import { StrokeSection } from "@/components/properties/StrokeSection";
import { EffectsSection } from "@/components/properties/EffectsSection";
import { TypographySection } from "@/components/properties/TypographySection";
import type { Effect, SceneNode, TextNode } from "@/types/scene";
import type { FillKind } from "@/components/properties/fillSectionUtils";


/**
 * A synthetic node's "parent" is never real (see `SYNTHETIC_EMBED_ELEMENT_ID`
 * in `embedElementNode.ts`), so every consumer of `ParentContext`/
 * `FlatParentContext` gets the same constant, non-auto-layout context.
 * Module-level (not `useMemo`'d per-render) since it never varies.
 */
const DETACHED_PARENT_CONTEXT: FlatParentContext = { parent: null, isInsideAutoLayout: false };

/** `video` renders as a real `<video>`/`<iframe>` element alongside the
 * node's background — no CSS property can insert a new element by writing
 * inline styles onto an existing one, so it's excluded here (see
 * `FillSection`'s `allowedFillKinds` doc comment). */
const ALLOWED_FILL_KINDS: FillKind[] = ["solid", "linear", "radial", "image", "pattern"];

/** `glass` and `noise` render entirely in Pixi via shaders and have no (or
 * only a lossy) CSS analogue — see `EffectsSection`'s `allowedEffectTypes`
 * doc comment. Shadows, layer blur and background/backdrop blur all round-trip
 * through plain CSS (`box-shadow`/`filter`/`backdrop-filter`). */
const ALLOWED_EFFECT_TYPES: Effect["type"][] = ["shadow", "blur", "background-blur"];

/**
 * Properties panel for a single element picked *inside* an embed's HTML
 * (via the embed element picker, `embedElementPicker.ts`/`EmbedLayer.tsx`).
 * Rendered by `PropertiesPanel` instead of the normal `PropertyEditor` while
 * `embedPickerStore.selection` points at the currently-selected embed node.
 *
 * This is assembled from the SAME native property sections `PropertyEditor`
 * uses for a real scene node — not a parallel, look-alike implementation —
 * via the `embedElementNode.ts` bridge (`embedElementToSyntheticNode`
 * reads a live DOM element into a `SyntheticNodeShape`;
 * `syntheticNodeToCssDeclarations`/`diffCssDeclarations` turn a patch back
 * into an inline-style diff written through `applyEmbedElementEdit`).
 *
 * Sections deliberately NOT included, and why — every one of these edits
 * something with no CSS-writable equivalent on an arbitrary existing HTML
 * element, or writes to the real scene graph/Pixi by `node.id`, which a
 * synthetic, store-less node can't safely do:
 * - **Type** — nothing to convert a live DOM element's tag to.
 * - **Position (+ Alignment) / Constraints** — the element's position is
 *   governed by normal flow/its own CSS, not scene-graph coordinates; this
 *   bridge always synthesizes the node at `x: 0, y: 0` with no parent to
 *   align against.
 * - **Layout grid** — a canvas-only overlay with no CSS output at all.
 * - **Shader** — bakes to a texture via WebGL and is applied as a Pixi
 *   sprite; `generateVisualStyles` never emits it.
 * - **Theme** — `themeOverride` lives on a real `FrameNode` in `nodesById`
 *   and is read by `getThemeFromAncestorFrames` by node id; a synthetic node
 *   was never in that tree to begin with.
 * - **Frame actions** — "Detach"/"Convert to component" etc. operate on a
 *   real scene subtree via `node.id`.
 * - **Embed content** — editing "the embed's HTML" doesn't apply to a
 *   single element already inside that HTML; "Edit inline" below is the
 *   equivalent entry point for this panel.
 * - **Selection colors** — reads the multi-select swatch list off real
 *   `SceneNode`s in the store.
 * - **Export settings** — `exportSettings` triggers real scene-graph export,
 *   keyed by `node.id`.
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

  const handleEditInline = useCallback(() => {
    if (!embedId) return;
    useSelectionStore.getState().startEditing(embedId, "embed");
  }, [embedId]);

  const htmlContent = useSceneStore((s) =>
    embedId ? ((s.nodesById[embedId] as { htmlContent?: string } | undefined)?.htmlContent ?? null) : null,
  );

  const variables = useVariableStore((s) => s.variables);
  const colorVariables = useMemo(() => variables.filter((v) => v.type === "color"), [variables]);
  // `activeTheme` must resolve THE SAME WAY the embed itself is rendered:
  // `EmbedLayer` mounts editor variables via the nearest ancestor frame's
  // `themeOverride`, falling back to the global active theme — never the
  // global theme unconditionally. Getting this wrong shows the wrong theme's
  // resolved colour in the swatch, and makes unbinding a variable write the
  // wrong theme's literal into `htmlContent`, so the element visibly jumps.
  // Composed from two selectors rather than a `getState()` helper so the
  // panel re-renders when either the scene tree or the global theme changes.
  const globalTheme = useThemeStore((s) => s.activeTheme);
  const activeTheme = useSceneStore((s) =>
    embedId ? getThemeFromAncestorFrames(s.parentById, s.nodesById, embedId, globalTheme) : globalTheme,
  );

  const [node, setNode] = useState<SyntheticNodeShape | null>(null);
  const [hasText, setHasText] = useState(false);
  // Distinguishes "haven't read yet" from "read, and the element genuinely
  // isn't there" — both start as `node === null`, but only the second should
  // render the "element unavailable" state instead of a blank panel during
  // the first rAF tick.
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
        setNode(null);
        setHasText(false);
        setResolved(true);
        return;
      }
      const el = findLiveEmbedElement(embedId, path);
      if (!el) {
        setNode(null);
        setHasText(false);
        setResolved(true);
        return;
      }
      const built = embedElementToSyntheticNode(el, useVariableStore.getState().variables);
      setNode(built.node);
      setHasText(built.hasText);
      setResolved(true);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [embedId, path, htmlContent]);

  // The single commit path every native section (via `onUpdate`) AND the
  // text-color row (via `onTextColorChange`/`onTextColorVariableChange`
  // below) funnel through. Merges the patch onto the current synthetic node,
  // regenerates the node's full CSS declaration set before/after, and writes
  // only what changed. Split out of `onUpdate` so the text-color row can pass
  // a `Partial<SyntheticNodeShape>` patch directly (its fields —
  // `textFill`/`textFillBinding` — don't exist on `SceneNode`, so routing
  // them through the `Partial<SceneNode>`-typed `onUpdate` would need an
  // unsafe cast at the call site instead of a plain, typed argument here).
  const commitPatch = useCallback(
    (patch: Partial<SyntheticNodeShape>) => {
      if (readOnly) return;
      // `embedId`/`path`/`htmlContent`/`node` are plain closure variables
      // (this function is recreated every render), so they're always current
      // as of the render that produced the event handler — no ref needed.
      if (!embedId || !path || htmlContent == null || !node) return;

      const nextNode: SyntheticNodeShape = { ...node, ...patch };

      // "Remove fill" (FillSection's only path that empties the fill stack
      // entirely) wants the class's own background to show back through —
      // not `background-color: transparent` forced over it — so every
      // background-related key gets `removeInsteadOfReset` for exactly this
      // transition (the paint STACK itself went from non-empty to empty).
      // Deliberately `getFills` (the raw stack), not `getRenderableFills`
      // (which also drops invisible/zero-opacity paints): hiding a fill via
      // its visibility toggle or dialing its layer opacity to 0 both leave
      // the paint in the stack, just unrenderable, and are edits the user
      // expects to see explicitly reflected (a transparent background), not
      // a removal that lets the class's own background show back through as
      // if the fill had never been touched. Any other diff (recoloring,
      // adding another fill, etc.) keeps the default explicit reset, same as
      // every other property this bridge diffs.
      const hadFill = getFills(node).length > 0;
      const hasFillNow = getFills(nextNode).length > 0;
      const diffOptions = hadFill && !hasFillNow
        ? { removeInsteadOfReset: BACKGROUND_STYLE_KEYS }
        : undefined;

      const styles = diffCssDeclarations(
        syntheticNodeToCssDeclarations(node),
        syntheticNodeToCssDeclarations(nextNode),
        diffOptions,
      );

      // Width/height are DELIBERATELY excluded from
      // `syntheticNodeToCssDeclarations` (see `LAYOUT_STYLE_ALLOWLIST`'s doc
      // comment) — `generateLayoutStyles` treats them as parent/sizing-mode
      // derived, which doesn't apply here. `SizeSection`'s W/H fields own
      // them directly instead: write them whenever the patch actually
      // touches them.
      if (patch.width !== undefined && patch.width !== node.width) {
        styles.width = `${nextNode.width}px`;
      }
      if (patch.height !== undefined && patch.height !== node.height) {
        styles.height = `${nextNode.height}px`;
      }

      // Bail out BEFORE the optimistic `setNode` below when the patch has no
      // CSS representation at all (e.g. `aspectRatioLocked`/`aspectRatio`,
      // `sizing.*` on their own): nothing is actually written for those
      // fields (there's no store-backed node to persist them on, only this
      // bridge's own CSS round-trip), and the next rAF re-read
      // (`embedElementToSyntheticNode`, triggered by any OTHER edit's
      // `htmlContent` change) rebuilds the node straight from the DOM, which
      // never populates them either — so an optimistic `setNode` here would
      // show the control as "applied" only for it to silently revert on the
      // very next unrelated edit. Only set local state for a patch that is
      // about to be (or already was) actually persisted.
      if (Object.keys(styles).length === 0) return;

      // Optimistic local update: every field in these sections commits on
      // every keystroke/click, and waiting for the rAF re-read above to
      // reflect it would make controls visibly lag/jump on each edit.
      setNode(nextNode);

      const result = applyEmbedElementEdit(htmlContent, path, { styles });
      if (!result) return;

      // ORDER MATTERS: `noteSelectionEdit` must land in the store BEFORE
      // `updateNode` writes the new `htmlContent`. `useEmbedPickerLifecycle`
      // is subscribed to sceneStore synchronously and clears `selection` the
      // moment it sees `htmlContent` diverge from `selectionHtmlSnapshot` —
      // if the snapshot update lands after the scene write, that check fires
      // first and this very selection (and thus this panel) disappears
      // mid-edit.
      useEmbedPickerStore.getState().noteSelectionEdit(result.html, result.outerHtml);
      // The picker path was built by walking the RENDERED shadow DOM, so
      // `htmlContent` (the only source of truth for an embed's markup) is
      // the right field to write the edit back to.
      useSceneStore.getState().updateNode(embedId, { htmlContent: result.html });
    },
    [readOnly, embedId, path, htmlContent, node],
  );

  // Every native section's `onUpdate` prop is typed `Partial<SceneNode>` —
  // `commitPatch` above accepts the bridge's own `Partial<SyntheticNodeShape>`
  // instead, so this is a thin, type-narrowing wrapper (safe: every field a
  // native section ever sends already exists on `SceneNode`, which is a
  // subset of `SyntheticNodeShape`'s merged fields).
  const onUpdate = useCallback(
    (updates: Partial<SceneNode>) => commitPatch(updates as Partial<SyntheticNodeShape>),
    [commitPatch],
  );

  // `TypographySection`'s `textColor` row — see that prop's doc comment for
  // why it bypasses `onUpdate` and calls `commitPatch` directly.
  const onTextColorChange = useCallback(
    (color: string) => commitPatch({ textFill: color }),
    [commitPatch],
  );
  const onTextColorVariableChange = useCallback(
    (variableId: string | undefined) => commitPatch({ textFillBinding: variableId ? { variableId } : undefined }),
    [commitPatch],
  );

  // The Text section edits the element's literal text content, a dimension
  // `onUpdate`'s CSS-declaration diff can't express (there is no CSS
  // property for "the text"). Kept as its own small write path, mirroring
  // `applyEmbedElementEdit`'s dedicated `text` field.
  const onTextChange = useCallback(
    (text: string) => {
      if (readOnly) return;
      if (!embedId || !path || htmlContent == null) return;
      const result = applyEmbedElementEdit(htmlContent, path, { text });
      if (!result) return;

      setNode((prev) => (prev ? { ...prev, text } : prev));

      // Same ordering requirement as `onUpdate` above.
      useEmbedPickerStore.getState().noteSelectionEdit(result.html, result.outerHtml);
      useSceneStore.getState().updateNode(embedId, { htmlContent: result.html });
    },
    [readOnly, embedId, path, htmlContent],
  );

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
          <div className="flex items-center gap-1">
            <IconButton
              tooltip="Edit inline"
              aria-label="Edit inline"
              variant="ghost"
              size="icon-sm"
              onClick={handleEditInline}
            >
              <PencilSimpleLineIcon />
            </IconButton>
            <IconButton
              tooltip="Back to embed"
              aria-label="Back to embed"
              variant="ghost"
              size="icon-sm"
              onClick={clearSelection}
            >
              <CaretLeftIcon />
            </IconButton>
          </div>
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

      {!resolved ? null : !node ? (
        <div className="px-4 py-3 text-[11px] text-text-muted">
          Element unavailable — it may no longer exist in this embed.
        </div>
      ) : (
        <>
          <SizeSection
            node={node}
            onUpdate={onUpdate}
            parentContext={DETACHED_PARENT_CONTEXT}
            useDirectUpdateOnly
            detachedNode
          />
          <AutoLayoutSection node={node} onUpdate={onUpdate} />
          <AppearanceSection node={node} onUpdate={onUpdate} hideCornerSmoothing />
          <FillSection
            node={node}
            onUpdate={onUpdate}
            colorVariables={colorVariables}
            activeTheme={activeTheme}
            allowedFillKinds={ALLOWED_FILL_KINDS}
            detachedNode
          />
          <StrokeSection
            node={node}
            onUpdate={onUpdate}
            colorVariables={colorVariables}
            activeTheme={activeTheme}
          />
          <EffectsSection
            node={node}
            onUpdate={onUpdate}
            allowedEffectTypes={ALLOWED_EFFECT_TYPES}
            detachedNode
          />
          {hasText && (
            <TypographySection
              node={node as unknown as TextNode}
              onUpdate={onUpdate}
              detachedNode
              hideStructuralText
              textColor={{
                value: node.textFill ?? "#000000",
                onChange: onTextColorChange,
                variableId: node.textFillBinding?.variableId,
                onVariableChange: onTextColorVariableChange,
                colorVariables,
                activeTheme,
              }}
            />
          )}
          {hasText && (
            <PropertySection title="Text">
              <TextInput value={node.text ?? ""} onChange={onTextChange} />
            </PropertySection>
          )}
        </>
      )}
    </>
  );
}
