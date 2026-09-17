/**
 * The bridge between a live HTML element inside an embed's shadow DOM and
 * the native properties-panel world (`SceneNode` + the real
 * `PropertyEditor` sections). This module is deliberately React-free and
 * store-free (with one documented, unavoidable exception — see
 * `syntheticNodeToCssDeclarations`) so it can be unit-tested against plain
 * DOM trees, the same way `embedElementStyle.ts` is.
 *
 * It does NOT reimplement CSS parsing/generation: every field comes from the
 * existing htmlToDesign/designToHtml conversion functions, which are already
 * covered by their own tests. This module's job is only the *shape*
 * translation (element ⇄ node) and the *diffing* rule that makes writing a
 * node patch back into an embed's inline style safe.
 */

import type {
  AlignItems,
  ColorBinding,
  FlexDirection,
  FrameNode,
  JustifyContent,
  TextNode,
} from "@/types/scene";
import type { Variable } from "@/types/variable";
import { applyBaseProps, applyBasePropsToText, applyTextProps } from "@/lib/htmlToDesign/styleApplication";
import { parsePadding } from "@/lib/htmlToDesign/elementChecks";
import { generateVisualStyles, generateTextStyles } from "@/lib/designToHtml/styleGeneration";
import { generateLayoutStyles } from "@/lib/designToHtml/layoutStyleGeneration";

/** Synthetic id given to the node built from a picked embed element. Chosen
 * to be obviously not a real scene-graph id (those are generated via
 * `generateId()`/nanoid-style ids and never contain a space or this literal
 * word), so a bug that accidentally let this id reach `nodesById` would be
 * loud rather than silently colliding with a real node. */
export const SYNTHETIC_EMBED_ELEMENT_ID = "embed-element";

/**
 * The merged node shape this module builds and hands back: every `FrameNode`
 * field, plus every `TextNode` field except `type` and `text` are optional.
 * `type` is deliberately omitted from the `TextNode` half — `FrameNode.type`
 * is the literal `'frame'` and `TextNode.type` is the literal `'text'`, so a
 * plain `FrameNode & Partial<TextNode>` intersection collapses `type` (and
 * therefore the whole type) to `never`. Excluding it keeps the intersection
 * meaningful while still exposing every typography field `Partial<TextNode>`
 * would have. See `SyntheticEmbedElementNode`'s doc comment for why the
 * fields are merged onto one object instead of two.
 */
export type SyntheticNodeShape = FrameNode & Partial<Omit<TextNode, "type">>;

/**
 * Result of reading a live element into scene-graph shape.
 *
 * Design choice: rather than a union (`FrameNode | TextNode`) or two
 * parallel objects, this returns ONE object typed as `SyntheticNodeShape`
 * (`FrameNode & Partial<TextNode>` minus the conflicting `type`).
 * Rationale:
 * - A picked embed element is always treated as a `frame` for layout/fill/
 *   stroke/effects purposes (native `AutoLayoutSection`, `FillSection`,
 *   `StrokeSection`, `EffectsSection` all key off `FrameNode`), regardless
 *   of whether it also carries editable text.
 * - Typography fields (`fontSize`, `fontWeight`, `lineHeight`, ...) are
 *   still meaningful even when the element has child elements and thus no
 *   directly-editable `text` (e.g. a `<button>` wrapping an icon + label) —
 *   `TypographySection` should still be able to show/edit them. So those
 *   fields are populated unconditionally, exactly mirroring how the old
 *   `EmbedElementStyleSnapshot` always read `fontSize`/`fontWeight`/etc.
 *   regardless of its own `text: string | null` gate.
 * - Only the literal text *content* is conditional (`hasText`): setting
 *   `node.text` when the element has child ELEMENTS would misrepresent an
 *   editable text field that doesn't actually exist, mirroring
 *   `readEmbedElementSnapshot`'s `VOID_TAGS`/`children.length === 0` rule.
 *
 * A caller that wants a strict `TextNode` for `TypographySection` casts:
 * `node as unknown as TextNode` — safe because every field that section
 * reads is always present (`type` is `'frame'` rather than `'text'`, but no
 * inspected code branches on it for read-only display of typography
 * controls; this is a deliberate, narrow lie kept in one place instead of
 * duplicating the whole node).
 */
export interface SyntheticEmbedElementNode {
  node: SyntheticNodeShape;
  /** True when the element has no child ELEMENTS and isn't a void/replaced
   * tag (`<img>`, `<input>`, ...) — i.e. `node.text` is a faithful, editable
   * representation of the element's content. */
  hasText: boolean;
}

function parsePx(value: string | undefined | null): number {
  if (!value) return 0;
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? 0 : n;
}

/** Tags that can never carry child text nodes — copied 1:1 from
 * `embedElementStyle.ts`'s `VOID_TAGS` (kept private there) since both
 * modules need the identical rule and it's small enough that a shared
 * export isn't worth the coupling. */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function elementHasEditableText(el: Element): boolean {
  return el.children.length === 0 && !VOID_TAGS.has(el.tagName.toLowerCase());
}

/** `display` values under which flex sub-properties are meaningful. Mirrors
 * `EmbedElementProperties.tsx`'s `isFlexDisplay`. */
function isFlexDisplay(display: string): boolean {
  return display === "flex" || display === "inline-flex";
}

/** Maps a computed `flex-direction` onto the app's `FlexDirection`, which
 * (unlike CSS) has no reverse variants — `AutoLayoutSection`'s model doesn't
 * support them. `row-reverse`/`column-reverse` collapse onto their
 * non-reversed counterpart; this is a known, documented lossy mapping (the
 * panel simply cannot express "reversed" today), not a bug. */
function mapFlexDirection(value: string): FlexDirection {
  return value.startsWith("column") ? "column" : "row";
}

/** Maps computed `align-items` onto the app's `AlignItems`, which has no
 * `normal`/`baseline`/`self-start`/... members. Anything outside the four
 * supported keywords returns `undefined` (field left unset) rather than
 * guessing — an absent field renders as "not set" in the panel, which is
 * honest; a wrong guess would not be. */
function mapAlignItems(value: string): AlignItems | undefined {
  switch (value) {
    case "flex-start":
    case "start":
      return "flex-start";
    case "center":
      return "center";
    case "flex-end":
    case "end":
      return "flex-end";
    case "stretch":
      return "stretch";
    default:
      return undefined;
  }
}

/** Maps computed `justify-content` onto the app's `JustifyContent`. Same
 * "unset rather than guess" rule as `mapAlignItems`. */
function mapJustifyContent(value: string): JustifyContent | undefined {
  switch (value) {
    case "flex-start":
    case "start":
      return "flex-start";
    case "center":
      return "center";
    case "flex-end":
    case "end":
      return "flex-end";
    case "space-between":
      return "space-between";
    case "space-around":
      return "space-around";
    case "space-evenly":
      return "space-evenly";
    default:
      return undefined;
  }
}

/** Same gap-reading rule as `embedElementStyle.ts`'s `readEmbedElementSnapshot`:
 * prefer the `gap` shorthand getter (the only one happy-dom populates from an
 * inline `gap:` declaration), falling back to the longhands. "normal" (the
 * initial value) reads as 0, matching the padding/gap "unset" convention
 * used throughout this panel. */
function parseGap(cs: CSSStyleDeclaration): number {
  const raw = cs.gap || cs.columnGap || cs.rowGap;
  if (!raw || raw === "normal") return 0;
  const n = Number.parseFloat(raw);
  return Number.isNaN(n) ? 0 : n;
}

/** Extracts the `--custom-property` name out of a literal `var(--x)` /
 * `var(--x, fallback)` string. Returns `null` for anything else (a resolved
 * color, `none`, empty, ...). Deliberately reads the element's OWN inline
 * `style` (not `getComputedStyle`): the computed style resolves a `var()`
 * reference down to its concrete value, so the literal reference is only
 * ever observable on the inline declaration that authored it. */
function parseVarReference(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^var\(\s*(--[a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/** Resolves a CSS custom-property name to a `ColorBinding`, by matching it
 * against `Variable.name` (which is itself stored as a `--kebab-name`
 * string — see `generateVisualStyles`' own `resolveBindingToCssVar`, the
 * write-side counterpart of this lookup). Deliberately takes `variables` as
 * a plain argument rather than reading `useVariableStore` directly: this
 * keeps the module import-free of Zustand, so it stays testable against
 * plain DOM trees/arrays exactly like `embedElementStyle.ts`, and so a
 * caller in a non-store context (e.g. a future server-side/test harness)
 * isn't forced to construct a store instance just to resolve a binding. */
function resolveVariableBinding(varName: string | null, variables: readonly Variable[]): ColorBinding | undefined {
  if (!varName) return undefined;
  const variable = variables.find((v) => v.name === varName);
  return variable ? { variableId: variable.id } : undefined;
}

/**
 * Build a synthetic `SceneNode`-shaped object from a LIVE element inside an
 * embed's shadow DOM, via `getComputedStyle` (for base/typography props,
 * which need resolved values) and the element's own inline `style` (for
 * variable-binding detection, which needs the literal, unresolved
 * declaration — see `parseVarReference`).
 *
 * `variables` is the current document's variable list (`useVariableStore`
 * state, passed in by the caller — see `resolveVariableBinding`'s doc
 * comment for why this module doesn't read the store itself). Defaults to
 * `[]`, which simply means no `var(--x)` reference can resolve to a binding
 * (falls through to the plain resolved-color fields, same as today).
 */
export function embedElementToSyntheticNode(
  el: Element,
  variables: readonly Variable[] = [],
): SyntheticEmbedElementNode {
  const cs = getComputedStyle(el);

  // offsetWidth/offsetHeight, NOT getBoundingClientRect(): EmbedLayer's
  // content container carries `transform: scale(viewportZoom)`
  // (`syncContentScale`), so a client rect is measured in post-transform
  // SCREEN pixels — at 200% zoom a 100px element reads as 200, and writing
  // that back as `width: 200px` would double the element on the very next
  // edit. The offset box is the untransformed layout box and round-trips
  // with the px value we write back. Both offset values are 0 in a DOM-only
  // test environment that never runs layout (or for elements happy-dom
  // never lays out), so fall back to the resolved computed size there —
  // same fallback `readEmbedElementSnapshot` (`embedElementStyle.ts`) uses,
  // for the identical reason.
  const layoutWidth = el instanceof HTMLElement ? el.offsetWidth : 0;
  const layoutHeight = el instanceof HTMLElement ? el.offsetHeight : 0;
  const width = layoutWidth || parsePx(cs.width);
  const height = layoutHeight || parsePx(cs.height);

  const node: SyntheticNodeShape = {
    id: SYNTHETIC_EMBED_ELEMENT_ID,
    type: "frame",
    name: el.tagName.toLowerCase(),
    x: 0,
    y: 0,
    width,
    height,
    children: [],
  };

  applyBaseProps(node, cs);
  applyBasePropsToText(node as unknown as TextNode, cs);
  applyTextProps(node as unknown as TextNode, cs);

  const hasText = elementHasEditableText(el);
  if (hasText) {
    node.text = el.textContent ?? "";
  }

  if (isFlexDisplay(cs.display)) {
    const padding = parsePadding(cs);
    node.layout = {
      autoLayout: true,
      flexDirection: mapFlexDirection(cs.flexDirection),
      gap: parseGap(cs),
      alignItems: mapAlignItems(cs.alignItems),
      justifyContent: mapJustifyContent(cs.justifyContent),
      paddingTop: padding.paddingTop,
      paddingRight: padding.paddingRight,
      paddingBottom: padding.paddingBottom,
      paddingLeft: padding.paddingLeft,
    };
  }

  // Variable bindings: read from the element's OWN inline style (the live
  // author-set declaration), not the resolved computed style — see
  // `parseVarReference`. `border-color` is preferred over `border-top-color`
  // when both resolve (the shorthand is what an author/panel would normally
  // set); `color` binds the SAME `fillBinding` field `background-color`
  // does, because `TextNode`/`FrameNode` share one `fillBinding` field and
  // this bridge merges both node "halves" into one object (see the
  // `SyntheticEmbedElementNode` doc comment). In practice an element is
  // rarely both a colored container AND colored text via two DIFFERENT
  // bound variables, so this collision is treated as out of scope; when both
  // are set, `color`'s binding wins (typography is applied after fill above).
  const inline = el instanceof HTMLElement ? el.style : undefined;
  const bgVar = parseVarReference(inline?.getPropertyValue("background-color"));
  const borderVar = parseVarReference(
    inline?.getPropertyValue("border-color") || inline?.getPropertyValue("border-top-color"),
  );
  const textColorVar = parseVarReference(inline?.getPropertyValue("color"));

  const fillBinding = resolveVariableBinding(bgVar, variables);
  if (fillBinding) node.fillBinding = fillBinding;
  const strokeBinding = resolveVariableBinding(borderVar, variables);
  if (strokeBinding) node.strokeBinding = strokeBinding;
  const textFillBinding = resolveVariableBinding(textColorVar, variables);
  if (textFillBinding) node.fillBinding = textFillBinding;

  return { node, hasText };
}

/**
 * CSS property keys `generateLayoutStyles` can emit that are meaningful for
 * an element living inside an embed's own HTML/CSS. Everything else it can
 * produce is specific to laying out a node INSIDE the design canvas's own
 * tree and would be actively wrong to force onto an arbitrary DOM element:
 * - `box-sizing: border-box` is emitted unconditionally for every node
 *   (canvas nodes always measure border-box) — an embed element's own CSS
 *   almost always already has a box-sizing reset of its own, and this
 *   bridge should not fight it for a property the panel has no control for
 *   in the first place.
 * - `position`/`left`/`top` come from the canvas's absolute-positioning
 *   model for non-auto-layout children — an embed element's position is
 *   governed by normal flow/its own CSS, not by scene-graph coordinates
 *   (this bridge always synthesizes the node at `x: 0, y: 0`).
 * - `width`/`height`/`flex`/`flex-shrink`/`min-*`/`max-*`/`align-self` come
 *   from the parent/sizing-mode machinery (`generateFlexChildStyles`) — this
 *   bridge always calls `generateLayoutStyles` with `isRoot: true` and no
 *   `parentLayout`, but isRoot still emits fixed `width`/`height`, which the
 *   panel's own "Size" fields (`W`/`H`) already own explicitly; letting the
 *   flex-layout path also emit them would fight that control on every edit.
 */
const LAYOUT_STYLE_ALLOWLIST = new Set([
  "display",
  "flex-direction",
  "flex-wrap",
  "gap",
  "row-gap",
  "column-gap",
  "align-items",
  "justify-content",
  "padding",
]);

/**
 * Build the full CSS declaration map for a synthetic node — everything the
 * native properties sections (`FillSection`, `StrokeSection`,
 * `EffectsSection`, `TypographySection`, `AutoLayoutSection`) could have
 * changed. Reuses `generateVisualStyles`/`generateTextStyles`/
 * `generateLayoutStyles` verbatim rather than re-deriving CSS from scratch,
 * so this bridge can never drift from the same generator the real
 * `designToHtml` export path uses.
 */
export function syntheticNodeToCssDeclarations(node: SyntheticNodeShape): Record<string, string> {
  const styles: Record<string, string> = {
    ...generateVisualStyles(node),
  };

  if (node.text !== undefined) {
    Object.assign(styles, generateTextStyles(node as unknown as TextNode));
  }

  const layoutStyles = generateLayoutStyles(node, undefined, true);
  for (const [key, value] of Object.entries(layoutStyles)) {
    if (LAYOUT_STYLE_ALLOWLIST.has(key)) {
      styles[key] = value;
    }
  }

  return styles;
}

/**
 * Explicit reset value used when a CSS property disappears between `before`
 * and `after` (see `diffCssDeclarations`'s doc comment for why this exists
 * at all). Built by walking every declaration key `generateVisualStyles`/
 * `generateTextStyles`/the allow-listed part of `generateLayoutStyles` can
 * emit (`styleGeneration.ts`, `layoutStyleGeneration.ts`) — not from memory.
 *
 * Each value is the property's real CSS initial value, picked so that
 * writing it inline is indistinguishable from "this property was never
 * touched by anything except the browser default" — EXCEPT `display`, which
 * has no single correct default (a `<div>`'s UA-stylesheet default is
 * `block`, a `<span>`'s is `inline`, and CSS's own spec-initial value
 * (`inline`) matches neither in general). `block` is used because turning
 * off auto-layout in the native panel is the one path that clears this key,
 * and every element this bridge is used against is presented to the user as
 * a block-level design element; documented limitation, not an oversight.
 */
const RESET_VALUES: Record<string, string> = {
  // generateVisualStyles — fill
  "background-color": "transparent",
  "background-image": "none",
  "background-size": "auto",
  "background-position": "0% 0%",
  "background-repeat": "repeat",
  "background-blend-mode": "normal",
  color: "initial",
  // generateVisualStyles — stroke
  border: "none",
  "border-top": "none",
  "border-right": "none",
  "border-bottom": "none",
  "border-left": "none",
  outline: "none",
  "border-image-source": "none",
  "border-image-slice": "100%",
  "box-sizing": "content-box",
  // generateVisualStyles — corner radius
  "border-radius": "0px",
  // generateVisualStyles — opacity
  opacity: "1",
  // generateVisualStyles — effects
  "box-shadow": "none",
  filter: "none",
  "backdrop-filter": "none",
  "-webkit-backdrop-filter": "none",
  // generateVisualStyles — transform
  transform: "none",
  // generateTextStyles
  "font-size": "medium",
  "font-family": "initial",
  "font-weight": "normal",
  "font-style": "normal",
  "font-variation-settings": "normal",
  "font-feature-settings": "normal",
  "text-align": "start",
  "line-height": "normal",
  "letter-spacing": "normal",
  "text-decoration": "none",
  "text-transform": "none",
  "white-space": "normal",
  "align-content": "normal",
  // generateLayoutStyles (allow-listed subset only)
  display: "block",
  "flex-direction": "row",
  "flex-wrap": "nowrap",
  gap: "normal",
  "row-gap": "normal",
  "column-gap": "normal",
  "align-items": "normal",
  "justify-content": "normal",
  padding: "0px",
};

/**
 * Diff two full CSS-declaration maps (as produced by
 * `syntheticNodeToCssDeclarations`) into the patch to hand to
 * `applyEmbedElementEdit`'s `styles` field.
 *
 * The obvious "if it's gone, remove the property" diff is WRONG here.
 * `generateVisualStyles`/`generateTextStyles` OMIT a declaration whenever
 * the underlying value equals the render default (radius 0 ⇒ no
 * `border-radius`; opacity 1 ⇒ no `opacity`) — that omission is a
 * generator-side space optimization, not a signal that the property should
 * be left alone. And an embed element is styled through CSS classes, not
 * (only) inline declarations: `target.style.removeProperty("padding-top")`
 * on an element whose class sets `padding-top: 16px` does nothing — the
 * class value reasserts itself the moment the inline override is gone, so
 * the field would silently snap back on the next read and the control would
 * look broken (this exact rule is already load-bearing in
 * `EmbedElementProperties.tsx`'s `ElementPropertyFields` doc comment).
 *
 * So a property that disappears from `after` is written back as an EXPLICIT
 * reset declaration (`RESET_VALUES`), which — being an inline `style`
 * declaration — always outranks the class rule regardless of specificity.
 * The one deliberate exception is `removeInsteadOfReset`: a caller-selected
 * allow-list of properties that should genuinely use `null` (→
 * `removeProperty`) instead — the panel's "Remove fill" action is the
 * concrete case (it wants the class's own background to show back through,
 * not force `transparent` over it).
 *
 * Border longhands (`border-width`/`border-color`/`border-style`) are
 * DELIBERATELY absent from this diff: `generateVisualStyles` never emits
 * them as separate declarations, only the composed `border`/`border-<side>`
 * shorthand (or `outline`) with the CURRENT full value baked in. So a
 * "stroke color only" edit naturally produces a single `border: "<current
 * width> solid <new color>"` declaration here — the width was never a
 * separate key to accidentally clobber. (This sidesteps the classic
 * `removeProperty("border-width")`-also-clears-the-shorthand trap entirely,
 * rather than working around it.)
 */
export function diffCssDeclarations(
  before: Record<string, string>,
  after: Record<string, string>,
  options?: { removeInsteadOfReset?: readonly string[] },
): Record<string, string | null> {
  const removeInsteadOfReset = new Set(options?.removeInsteadOfReset ?? []);
  const patch: Record<string, string | null> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    const beforeValue = before[key];
    const afterValue = after[key];

    if (afterValue !== undefined) {
      if (afterValue !== beforeValue) {
        patch[key] = afterValue;
      }
      continue;
    }

    // Present before, absent now: a real disappearance (not "never existed").
    if (beforeValue === undefined) continue;

    if (removeInsteadOfReset.has(key)) {
      patch[key] = null;
      continue;
    }

    // Fall back to `null` for anything not in the table — that would mean a
    // NEW key from a future generator change that this table hasn't been
    // taught yet; removing is at least safe (it just means the class's own
    // value can show through instead of an explicit reset), never wrong the
    // way clobbering an unrelated longhand would be.
    patch[key] = RESET_VALUES[key] ?? null;
  }

  return patch;
}
