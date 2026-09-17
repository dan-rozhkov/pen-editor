import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { EmbedElementProperties } from "../EmbedElementProperties";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useVariableStore } from "@/store/variableStore";
import { resetStores } from "@/test/fixtures";
import { describeEmbedElement, buildElementPath } from "@/lib/embedElementPicker";
import { readEmbedElementSnapshot } from "@/lib/embedElementStyle";
import * as embedElementStyle from "@/lib/embedElementStyle";
import { mountHtmlWithBodyStyles } from "@/utils/embedHtmlUtils";
import type { EmbedNode } from "@/types/scene";
import type { Variable } from "@/types/variable";

// Same rationale as embedElementStyle.test.ts: DOMPurify's tag walk is a
// no-op against happy-dom's DOMParser document, so `mountHtmlWithBodyStyles`
// (called unconditionally) is stubbed to the identity function here too.
vi.mock("@/utils/sanitizeEmbedHtml", () => ({
  sanitizeEmbedHtml: (html: string) => html,
}));

// This panel is assembled entirely from native sections (`FillSection`,
// `StrokeSection`, `EffectsSection`, ...) which drive their per-row detail
// editors through a base-ui Popover/DropdownMenu that portals and is flaky
// to drive open in happy-dom. Same approach `FillSection.test.tsx`/
// `StrokeSection.test.tsx` use: render trigger + content inline so the
// detail controls (color, variable binding, blend mode, ...) are always in
// the DOM, and treat a dropdown "item" as a plain button.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  // `render` (an explicit trigger element, e.g. `<IconButton>`) is used by
  // `BlendModeDropdown`; plain `children` (e.g. an inline svg) is used by
  // `ColorInput`'s "bind to variable" trigger — support both.
  DropdownMenuTrigger: ({
    children,
    render,
    ...props
  }: ComponentProps<"button"> & { render?: ReactNode }) =>
    render ?? (
      <button type="button" {...props}>
        {children}
      </button>
    ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: ComponentProps<"button">) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuRadioGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const EMBED_ID = "embed1";

/** Mount `html` into a shadow-DOM host tagged with `data-embed-id`, the way
 * `EmbedLayer.tsx` mounts a real embed node — mirrors the setup in
 * `embedElementStyle.test.ts`. */
function mountEmbedHost(html: string, width = 300, height = 200) {
  const host = document.createElement("div");
  host.setAttribute("data-embed-id", EMBED_ID);
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const content = document.createElement("div");
  mountHtmlWithBodyStyles(content, html, width, height);
  shadow.appendChild(content);
  return { host, shadow };
}

/**
 * Re-mount `shadow`'s content from the CURRENT `htmlContent`, mirroring what
 * a real `EmbedLayer` does in its own `useEffect` whenever `htmlContent`
 * changes. `mountEmbedHost` only mounts once — this test file otherwise has
 * no live component keeping the shadow DOM in sync with the store, so a test
 * that edits more than once and wants the panel's NEXT rAF re-read
 * (`embedElementToSyntheticNode`) to see the write it just made needs this
 * between edits, or it would keep reading the ORIGINAL, now-stale live
 * element and undo the optimistic `setNode` the moment the effect re-fires.
 */
function resyncEmbedHost(shadow: ShadowRoot, html: string, width = 300, height = 200): void {
  shadow.replaceChildren();
  const content = document.createElement("div");
  mountHtmlWithBodyStyles(content, html, width, height);
  shadow.appendChild(content);
}

function seedEmbedNode(html: string): void {
  const node: EmbedNode = {
    id: EMBED_ID,
    type: "embed",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    htmlContent: html,
  };
  useSceneStore.getState().addNode(node);
  useSelectionStore.getState().select(EMBED_ID);
}

/** Pick the given live element the way the real picker does (path + preview
 * object), and register it as the current selection. */
function selectElement(el: Element, shadow: ShadowRoot, html: string): void {
  const path = buildElementPath(el, shadow);
  const selection = describeEmbedElement(el, shadow, EMBED_ID);
  useEmbedPickerStore.getState().selectElement(selection, html);
  // Sanity: path used by describeEmbedElement should match ours.
  expect(selection.path).toBe(path);
}

async function flushRaf(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

function currentHtml(): string {
  return (useSceneStore.getState().nodesById[EMBED_ID] as EmbedNode).htmlContent;
}

/** The `div.card` fixture's OWN inline `box-sizing`, parsed fresh from the
 * current `htmlContent` — never a substring check on the raw html, which
 * would also match a class-level `box-sizing` rule declared in a `<style>`
 * block elsewhere in the same document. */
function cardInlineBoxSizing(): string {
  const doc = new DOMParser().parseFromString(currentHtml(), "text/html");
  return (doc.querySelector("div.card") as HTMLElement | null)?.style.boxSizing ?? "";
}

/** Scope queries to one PropertySection by its title text (sections have no
 * accessible region role, just a styled title `<div>`), since several
 * sections repeat the same field labels ("W", displayed "0", etc). */
function getSection(title: string): HTMLElement {
  return screen.getByText(title, { exact: true }).closest(".relative.border-b") as HTMLElement;
}

/** Find the `role="combobox"` trigger for a `SelectInput`'s label within
 * `scope`, the same "walk up from the label text" approach
 * `StrokeSection.test.tsx`'s `numberInputFor` uses for `NumberInput` — a
 * `SelectInput` has no other accessible link between its `<Label>` and its
 * trigger either. */
function comboboxFor(scope: HTMLElement, label: string): HTMLElement {
  let container: HTMLElement | null = within(scope).getByText(label, { exact: true }).parentElement;
  while (container) {
    const combobox = container.querySelector('[role="combobox"]');
    if (combobox) return combobox as HTMLElement;
    container = container.parentElement;
  }
  throw new Error(`No combobox found for label "${label}"`);
}

/**
 * Select an already-open `SelectInput`'s option by name. Mirrors
 * `DevExportSection.test.tsx`'s `selectOption`: `@base-ui/react`'s
 * `Select.Item` only commits a bare `click` when its OWN `pointerdown`
 * landed on it first (guards against the trigger's opening click also
 * landing on an item, since `SelectContent` uses `alignItemWithTrigger`) — a
 * plain `fireEvent.click(option)` is silently ignored.
 */
function selectOption(name: string) {
  const option = screen.getByRole("option", { name });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

describe("<EmbedElementProperties />", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("renders values read from the live element via the native sections", async () => {
    const html = `<div class="card" style="display:flex;padding:4px 8px 4px 8px;background-color:rgb(255,0,0);font-size:14px;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    expect(screen.getByText("div.card")).toBeTruthy();
    // Typography section (native `TypographySection`) — font-size.
    expect(screen.getByDisplayValue("14")).toBeTruthy();
    // Fill section (native `FillSection`) — background color hex. The text
    // input is queried by placeholder (not `getByDisplayValue`) because the
    // native swatch is ALSO a real `<input type="color">` carrying the same
    // value, so a value-based query is ambiguous.
    const fillColorInput = within(getSection("Fill")).getByPlaceholderText(
      "#000000",
    ) as HTMLInputElement;
    expect(fillColorInput.value).toBe("#FF0000");
  });

  it("hides sections with no CSS-writable equivalent, and shows only the native ones", async () => {
    const html = `<div class="card" style="background-color:#ff0000;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    for (const title of [
      "Position",
      "Constraints",
      "Layout grid",
      "Shader",
      "Theme",
      "Type",
      "Embed",
      "Export",
      "Selection colors",
    ]) {
      expect(screen.queryByText(new RegExp(`^${title}`, "i"))).toBeNull();
    }
    // The sections that ARE part of the assembly.
    for (const title of ["Size", "Auto Layout", "Appearance", "Fill", "Stroke", "Effects"]) {
      expect(screen.getByText(title, { exact: true })).toBeTruthy();
    }
  });

  it("edits a typography field (native TypographySection), writes htmlContent, and keeps selection alive", async () => {
    const html = `<div class="card" style="font-size:14px;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const fontSizeInput = screen.getByDisplayValue("14");
    fireEvent.change(fontSizeInput, { target: { value: "20" } });

    expect(currentHtml()).toContain("font-size: 20px");

    // Selection must survive the write — noteSelectionEdit must have run
    // BEFORE updateNode so useEmbedPickerLifecycle's staleness check (which
    // isn't mounted in this test, but the snapshot invariant still holds)
    // never sees a snapshot mismatch.
    const { selection, selectionHtmlSnapshot } = useEmbedPickerStore.getState();
    expect(selection).not.toBeNull();
    expect(selectionHtmlSnapshot).toBe(currentHtml());
  });

  it("edits the background color via the native Fill section and writes the expected CSS declaration", async () => {
    const html = `<div class="card" style="background-color:#ff0000;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const fillSection = getSection("Fill");
    const colorInput = within(fillSection).getByPlaceholderText("#000000");
    fireEvent.change(colorInput, { target: { value: "#00ff00" } });

    expect(currentHtml().toLowerCase()).toContain("background-color: #00ff00");
  });

  it("enables auto layout via the native Auto Layout section and writes display: flex", async () => {
    const html = `<div class="card">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    fireEvent.click(screen.getByRole("button", { name: "Enable auto layout" }));

    expect(currentHtml()).toContain("display: flex");
  });

  it("edits the element's text content via the Text section", async () => {
    const html = `<p>old</p>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("p")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const textInput = screen.getByDisplayValue("old");
    fireEvent.change(textInput, { target: { value: "new" } });

    expect(currentHtml()).toContain("<p>new</p>");
  });

  it("shows an 'element unavailable' state instead of blank fields when the host isn't mounted", async () => {
    const html = `<p>hi</p>`;
    seedEmbedNode(html);
    // No mountEmbedHost() call — the shadow host never exists in the DOM.
    const selection = {
      embedId: EMBED_ID,
      path: "div:nth-of-type(1) > p:nth-of-type(1)",
      tagName: "p",
      classes: [],
      textPreview: "hi",
      outerHtml: "<p>hi</p>",
    };
    useEmbedPickerStore.getState().selectElement(selection, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    expect(screen.getByText(/element unavailable/i)).toBeTruthy();
  });

  it("PropertiesPanel shows the element panel instead of the embed's normal editor when a selection exists", async () => {
    const html = `<div class="card">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<PropertiesPanel />);
    await flushRaf();

    expect(screen.getByText("div.card")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to embed" })).toBeTruthy();
  });

  it("changing only the stroke color keeps the existing border-width (regression: used to null out untouched longhands)", async () => {
    const html = `<div class="card" style="border: 2px solid #333333;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const strokeSection = getSection("Stroke");
    const strokeColorInput = within(strokeSection).getByPlaceholderText("#000000");
    fireEvent.change(strokeColorInput, { target: { value: "#ff00ff" } });

    const lower = currentHtml().toLowerCase();
    // The width lives inside the original `border: 2px solid ...` shorthand
    // (CSSOM keeps it as a shorthand when only the color longhand is
    // touched) — so the width survives as "2px" and the old color is gone,
    // rather than the shorthand being exploded into longhands.
    expect(lower).toContain("2px");
    expect(lower).not.toContain("#333333");
    expect(lower).toContain("#ff00ff");
  });

  it("adding a stroke via the native Stroke section writes an active (solid) border", async () => {
    // Regression, adapted for the native section: the old bespoke panel had
    // a "Style" select (none/solid/dashed/dotted) and asserted that setting
    // a non-zero width on a `border-style: none` element implicitly flips it
    // to solid. `StrokeSection`/`generateVisualStyles` have no border-style
    // concept at all (every stroke this app can express renders as a plain
    // solid CSS border) — the equivalent, still-meaningful fact here is that
    // touching the native stroke control on a border-less element produces
    // a real, visible border rather than a no-op.
    const html = `<div class="card" style="border-style: none;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    fireEvent.click(screen.getByRole("button", { name: "Add stroke" }));

    let lower = currentHtml().toLowerCase();
    expect(lower).toContain("border: 1px solid");

    const strokeSection = getSection("Stroke");
    const weightInput = within(strokeSection).getByDisplayValue("1");
    fireEvent.change(weightInput, { target: { value: "3" } });

    lower = currentHtml().toLowerCase();
    expect(lower).toContain("border: 3px solid");
  });

  it("toggling stroke Align between Inside and Center writes box-sizing and reaches html (bug repro: dead control)", async () => {
    // Bug: `syntheticNodeToCssDeclarations` used to strip `box-sizing`
    // unconditionally, but `generateVisualStyles` renders `strokeAlign:
    // "inside"` and `"center"` into the exact same `border: <w> solid <c>`
    // declaration — `box-sizing` was the ONLY thing telling them apart. With
    // it stripped, switching Align diffed to an empty patch, `commitPatch`
    // bailed out before writing anything, and the select silently reverted
    // to "Inside" on the next rAF re-read (`applyStrokeAlignFromCss` reading
    // the unchanged `box-sizing: border-box` straight off the DOM).
    //
    // Inside → Center is asserted to REMOVE the inline `box-sizing` rather
    // than force it to `content-box`: that forced write was a fourth-round
    // review finding of its own (a class-authored `border-box` reset would
    // otherwise fight it right back), and `applyStrokeAlignFromCss` now
    // reads only the element's own INLINE `box-sizing` to decide Inside — so
    // "no inline box-sizing" already reads correctly as Center without
    // forcing anything.
    const html = `<div class="card" style="border:1px solid #dddddd;box-sizing:border-box;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const strokeSection = getSection("Stroke");
    const alignCombobox = comboboxFor(strokeSection, "Align");

    fireEvent.click(alignCombobox);
    selectOption("Center");
    resyncEmbedHost(shadow, currentHtml());
    await flushRaf();

    let lower = currentHtml().toLowerCase();
    expect(lower).not.toContain("box-sizing");
    // The select must reflect the write on the next re-read, not silently
    // revert to "Inside" (the exact failure mode of the original bug).
    expect(comboboxFor(getSection("Stroke"), "Align").textContent).toContain("Center");

    // And back the other way, so this isn't just "any write sticks".
    fireEvent.click(comboboxFor(getSection("Stroke"), "Align"));
    selectOption("Inside");
    resyncEmbedHost(shadow, currentHtml());
    await flushRaf();

    lower = currentHtml().toLowerCase();
    expect(lower).toContain("box-sizing: border-box");
    expect(comboboxFor(getSection("Stroke"), "Align").textContent).toContain("Inside");
  });

  it("Align cycles through Center/Outside/Inside/Outside/Center without reverting, under a CLASS-authored box-sizing reset (bug repro: Outside → Center stayed dead)", async () => {
    // Fourth-round review finding: `applyStrokeAlignFromCss` used to read
    // `cs.boxSizing` (cascade-resolved), so a class-level
    // `box-sizing: border-box` reset — near-universal in generated embed
    // HTML — made a plain bordered element read back as "Inside" even though
    // nothing here ever wrote it. Switching Align to Outside or Center never
    // touches `box-sizing` at all (`generateVisualStyles` only ever emits it
    // for `strokeAlign: "inside"`), so the class value survived every write
    // and `applyStrokeAlignFromCss` read the element as "Inside" again on
    // the very next re-read — the Align select was stuck, unable to
    // represent "Center" or "Outside" at all once a class reset was present.
    const html =
      `<style>.card { box-sizing: border-box; }</style>` +
      `<div class="card" style="border:1px solid #dddddd;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    expect(getComputedStyle(target).boxSizing).toBe("border-box");
    expect((target as HTMLElement).style.boxSizing).toBe("");
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const strokeSection = () => getSection("Stroke");
    const align = () => comboboxFor(strokeSection(), "Align");

    // Initial read: the class reset must NOT be mistaken for this element's
    // own Inside alignment.
    expect(align().textContent).toContain("Center");

    fireEvent.click(align());
    selectOption("Outside");
    resyncEmbedHost(shadow, currentHtml());
    await flushRaf();
    expect(cardInlineBoxSizing()).toBe("");
    expect(align().textContent).toContain("Outside");

    // The bug: this used to render "Inside" again.
    fireEvent.click(align());
    selectOption("Center");
    resyncEmbedHost(shadow, currentHtml());
    await flushRaf();
    expect(cardInlineBoxSizing()).toBe("");
    expect(align().textContent).toContain("Center");

    fireEvent.click(align());
    selectOption("Inside");
    resyncEmbedHost(shadow, currentHtml());
    await flushRaf();
    expect(cardInlineBoxSizing()).toBe("border-box");
    expect(align().textContent).toContain("Inside");

    // Inside → Outside must not clobber box-sizing with content-box either
    // (the same fix as the dedicated regression test above, exercised here
    // as part of the full three-value matrix).
    fireEvent.click(align());
    selectOption("Outside");
    resyncEmbedHost(shadow, currentHtml());
    await flushRaf();
    expect(cardInlineBoxSizing()).not.toBe("content-box");
    expect(align().textContent).toContain("Outside");

    fireEvent.click(align());
    selectOption("Center");
    resyncEmbedHost(shadow, currentHtml());
    await flushRaf();
    expect(align().textContent).toContain("Center");
  });

  it("switching Align from Inside to Outside does not clobber box-sizing with content-box (bug repro)", async () => {
    // Bug: the `removeInsteadOfReset` decision for `box-sizing` was keyed off
    // whether the raw stroke PAINT STACK (`getStrokes`) went from non-empty
    // to empty ("stroke removed entirely"). Inside → Outside keeps the stack
    // non-empty (the stroke just moves to `outline`), yet `box-sizing`
    // disappears from the generated CSS map just the same (`outside` never
    // emits it) — so this transition fell through to the default explicit
    // reset and forced `box-sizing: content-box` inline, permanently
    // overriding the embed's own `* { box-sizing: border-box }` reset for a
    // property this edit never intended to touch.
    const html = `<div class="card" style="border:1px solid #dddddd;box-sizing:border-box;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const strokeSection = getSection("Stroke");
    const alignCombobox = comboboxFor(strokeSection, "Align");
    fireEvent.click(alignCombobox);
    selectOption("Outside");

    const lower = currentHtml().toLowerCase();
    expect(lower).not.toContain("box-sizing: content-box");
    // happy-dom's CSSOM re-explodes the `outline` shorthand into longhands
    // when serialized (same documented quirk as the border-shorthand assert
    // in the "binding Stroke to a color variable" test above) — assert the
    // longhands rather than the shorthand string.
    expect(lower).toContain("outline-width: 1px");
    expect(lower).toContain("outline-color: #dddddd");
  });

  it("setting stroke weight to 0 does not clobber box-sizing with content-box (bug repro)", async () => {
    // Same root cause as the Inside→Outside case above, different trigger:
    // dialing the weight to 0 leaves the raw paint stack untouched
    // (`getStrokes` stays non-empty — only `strokeWidth` changed), but
    // `generateVisualStyles` stops emitting border/outline/box-sizing
    // entirely once `strokeWidth` is falsy, so `box-sizing` still disappears
    // from the generated map and got forced to `content-box` under the old
    // stack-emptiness criterion.
    const html = `<div class="card" style="border:1px solid #dddddd;box-sizing:border-box;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const strokeSection = getSection("Stroke");
    const weightInput = within(strokeSection).getByDisplayValue("1");
    fireEvent.change(weightInput, { target: { value: "0" } });

    const lower = currentHtml().toLowerCase();
    expect(lower).not.toContain("box-sizing: content-box");
  });

  it("removing a stroke does not leave box-sizing: content-box inline (bug repro)", async () => {
    // The fix for the Align control above must not regress the original,
    // legitimate concern it was trying to address: removing a stroke
    // entirely should let the embed's own `box-sizing` reset (near-universal
    // in generated embed HTML) show back through, not force an explicit
    // `content-box` that fights it. Mirrors `BACKGROUND_STYLE_KEYS`'s
    // "Remove fill" handling.
    const html = `<div class="card" style="border:1px solid #dddddd;box-sizing:border-box;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    fireEvent.click(screen.getByRole("button", { name: "Remove stroke" }));

    const lower = currentHtml().toLowerCase();
    expect(lower).not.toContain("box-sizing");
  });

  it("writes an explicit padding: 0px rather than removing the declaration (removal wouldn't override a class)", async () => {
    // Regression: every write in this panel is documented to write an
    // explicit value, never `null`/remove — because embed HTML is styled
    // through classes, and removing an inline declaration that was never
    // there is a no-op (the class value shows through unchanged). The
    // native `AutoLayoutSection` emits the whole `padding` shorthand (not
    // individual `padding-top`/... longhands like the old bespoke panel
    // did) — asserting an explicit "padding: 0px" (not the declaration
    // vanishing) is what distinguishes "set to zero" from "unset" here.
    const html = `<div class="card" style="display:flex;padding-top:10px;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const autoLayoutSection = getSection("Auto Layout");
    const padTInput = within(autoLayoutSection).getByDisplayValue("10");
    fireEvent.change(padTInput, { target: { value: "0" } });

    expect(currentHtml()).toContain("padding: 0px");
  });

  it("removing the last fill removes the inline declaration instead of forcing background-color: transparent", async () => {
    // Bug: `onUpdate`'s `diffCssDeclarations` call never opts into
    // `removeInsteadOfReset`, so removing the only fill (which empties
    // `node.fills` entirely) reads as "background-color disappeared" and
    // gets an explicit `RESET_VALUES` reset (`transparent`) written inline —
    // permanently hiding whatever background the element's own CSS class
    // would otherwise show through, instead of letting it show through.
    const html = `<div class="card" style="background-color:#ff0000;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    fireEvent.click(screen.getByRole("button", { name: "Remove fill" }));

    const lower = currentHtml().toLowerCase();
    expect(lower).not.toContain("background-color");
  });

  it("hiding a fill (visibility toggle) writes an explicit reset, not removeProperty (bug repro)", async () => {
    // Bug: `hadFill`/`hasFillNow` were computed from `getRenderableFills`,
    // which also filters out `visible: false` — so toggling a fill's
    // visibility off (not removing it) was indistinguishable from the
    // "Remove fill" action and took the `removeInsteadOfReset` branch,
    // deleting the inline `background-color` entirely instead of writing an
    // explicit reset. On a class-styled element that makes "hide" show the
    // class's own background back through.
    const html = `<div class="card" style="background-color:#ff0000;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    fireEvent.click(screen.getByRole("button", { name: "Hide fill" }));

    const lower = currentHtml().toLowerCase();
    expect(lower).toContain("background-color: transparent");
  });

  it("setting a fill's layer opacity to 0 writes an explicit reset, not removeProperty (bug repro)", async () => {
    const html = `<div class="card" style="background-color:#ff0000;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const fillSection = getSection("Fill");
    // Scoped to `type="number"` — the color picker's own sliders in this
    // section also carry a display value of "100" (saturation/brightness).
    const opacityInput = within(fillSection)
      .getAllByDisplayValue("100")
      .find((el) => el.getAttribute("type") === "number") as HTMLInputElement;
    fireEvent.change(opacityInput, { target: { value: "0" } });

    const lower = currentHtml().toLowerCase();
    expect(lower).toContain("background-color: transparent");
  });

  it("editing the single Gap field updates per-axis gaps set outside the panel (bug repro: dead control)", async () => {
    // `parseGaps` reads `gap: 10px 20px` into `{gap:10, rowGap:10,
    // columnGap:20}` even though `flexWrap` is off, so `AutoLayoutSection`
    // shows only the single "Gap" input (gated on `flexWrap`) — but that
    // input only ever wrote `layout.gap`, and `generateLayoutStyles` prefers
    // `rowGap`/`columnGap` whenever either is defined, so the generated CSS
    // (and thus the diff) never changed and the edit was silently dropped.
    const html = `<div class="card" style="display:flex;gap:10px 20px;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    // Captures the exact `edit.styles` patch `commitPatch` computes and hands
    // to `applyEmbedElementEdit`, independent of any DOM re-serialization or
    // read-side fallback — see the comment below for why a live-DOM re-read
    // isn't enough on its own to pin this.
    const applySpy = vi.spyOn(embedElementStyle, "applyEmbedElementEdit");

    const autoLayoutSection = getSection("Auto Layout");
    const gapInput = within(autoLayoutSection).getByDisplayValue("10");
    fireEvent.change(gapInput, { target: { value: "15" } });

    // The patch object itself: `AutoLayoutSection`'s single "Gap" field
    // clears `rowGap`/`columnGap` on the node (see its own comment), so
    // `generateLayoutStyles` stops emitting the `row-gap: 20px`/`column-gap:
    // 20px` declarations that were in "before" — `diffCssDeclarations` must
    // therefore emit explicit RESETS for both longhands alongside the new
    // `gap`, or a class-authored per-axis gap would survive under the
    // written `gap` shorthand exactly like a stale, unreset `box-sizing`
    // would (this test's sibling bug class). Asserted on the actual call
    // argument, NOT a live re-read: `readEmbedElementSnapshot`'s own
    // `cs.gap || cs.columnGap || cs.rowGap` fallback (needed for a DIFFERENT,
    // legitimate happy-dom quirk — see below) would report `gap: 15` from the
    // `gap` declaration alone even if the `row-gap`/`column-gap` resets were
    // silently dropped from the patch, so that read-back alone cannot catch
    // their disappearance.
    const lastEditArg = applySpy.mock.calls.at(-1)?.[2];
    expect(lastEditArg?.styles).toMatchObject({
      gap: "15px",
      "row-gap": "normal",
      "column-gap": "normal",
    });

    // And the dead-control regression this test originally guarded against:
    // the write must also actually reach a live element's EFFECTIVE gap.
    // Not a string-containment check on the serialized `style` attribute:
    // `applyEmbedElementEdit` calls `target.style.setProperty` in patch
    // order (`row-gap`, `column-gap`, THEN `gap` — see
    // `syntheticNodeToCssDeclarations`'s `LAYOUT_STYLE_ALLOWLIST` insertion
    // order), and in a real browser the `gap` shorthand set last overwrites
    // the row-gap/column-gap longhands it also owns, serializing to just
    // `gap: 15px` with no longhands at all. happy-dom's `CSSStyleDeclaration`
    // doesn't do that expansion — it keeps `row-gap: normal` and
    // `column-gap: normal` as separate, stale-looking entries alongside
    // `gap: 15px` — so asserting on the raw string would pin that
    // environment quirk (and would break the moment happy-dom's CSSOM is
    // fixed). Instead, parse the RESOLVED value the same way this bridge's
    // own read path does (`readEmbedElementSnapshot`'s `cs.gap || cs.columnGap
    // || cs.rowGap` fallback, written for exactly this happy-dom gap-serialization
    // quirk in the other direction) against a fresh mount of the written html,
    // so this fails if the single Gap field ever stops actually changing the
    // element's effective gap again.
    const { shadow: editedShadow } = mountEmbedHost(currentHtml());
    const editedTarget = editedShadow.querySelector("div.card")!;
    expect(readEmbedElementSnapshot(editedTarget).gap).toBe(15);
  });

  it("a CSS-less field (aspect ratio lock) never shows as applied, since it can't actually be persisted here", async () => {
    // Bug: `onUpdate` called `setNode(nextNode)` BEFORE checking whether the
    // patch produced any CSS to write. `aspectRatioLocked` has no CSS
    // representation at all, so nothing is ever persisted for it — but the
    // optimistic `setNode` still flipped the local `node` state, making the
    // button render as "locked" until the next unrelated real edit's rAF
    // re-read silently discarded it again. Fixed by moving the "nothing to
    // write" bail-out before `setNode`, so this field never shows a state
    // that isn't backed by anything real.
    const html = `<div class="card" style="background-color:#ff0000;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    fireEvent.click(screen.getByRole("button", { name: "Lock aspect ratio" }));

    // Nothing was actually written...
    expect(currentHtml()).toBe(html);
    // ...so the control must not present a "locked" state that has nothing
    // behind it.
    expect(screen.queryByRole("button", { name: "Unlock aspect ratio" })).toBeNull();
  });

  it("has its own 'Edit inline' button that opens InlineEmbedEditor without deselecting the element first", async () => {
    // Regression: after EmbedActionBar's removal, EmbedContentSection's
    // "Edit inline" button was the ONLY way to reach startEditing(id,
    // "embed") — but PropertiesPanel swaps this component in for the embed's
    // normal PropertyEditor (and thus EmbedContentSection) the instant an
    // element is picked, which is the normal first click on any embed now
    // that picking is always-on. That left the button reachable only via
    // Escape first. This panel needs its own entry point wired to the same
    // action.
    const html = `<div class="card">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    fireEvent.click(screen.getByRole("button", { name: "Edit inline" }));

    const { editingMode, editingNodeId } = useSelectionStore.getState();
    expect(editingMode).toBe("embed");
    expect(editingNodeId).toBe(EMBED_ID);
  });

  it("PropertiesPanel shows the normal embed editor when there is no element selection", () => {
    const html = `<div class="card">hi</div>`;
    seedEmbedNode(html);
    mountEmbedHost(html);
    // No selectElement() call.

    render(<PropertiesPanel />);

    expect(screen.queryByRole("button", { name: "Back to embed" })).toBeNull();
  });

  it("shows the Typography and Text sections only for an element with editable text", async () => {
    const html = `<div class="wrap"><span>only child, no text of its own</span></div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.wrap")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    expect(screen.queryByText("Typography", { exact: true })).toBeNull();
    expect(screen.queryByText("Text", { exact: true })).toBeNull();
  });

  describe("text color (TypographySection's textColor row)", () => {
    it("edits the text color and writes `color:` without touching `background-color:`", async () => {
      const html = `<div class="card" style="background-color:#ff0000;color:#0000ff;">hi</div>`;
      seedEmbedNode(html);
      const { shadow } = mountEmbedHost(html);
      const target = shadow.querySelector("div.card")!;
      selectElement(target, shadow, html);

      render(<EmbedElementProperties />);
      await flushRaf();

      const typographySection = getSection("Typography");
      const colorInput = within(typographySection).getByPlaceholderText("#000000");
      fireEvent.change(colorInput, { target: { value: "#112233" } });

      const lower = currentHtml().toLowerCase();
      expect(lower).toContain("color: #112233");
      expect(lower).toContain("background-color: #ff0000");
    });

    it("binding the text color to a color variable writes color: var(--name)", async () => {
      const variable: Variable = {
        id: "var-brand",
        name: "--brand-500",
        type: "color",
        value: "#112233",
      };
      useVariableStore.getState().setVariables([variable]);
      const html = `<div class="card" style="color:#0000ff;">hi</div>`;
      seedEmbedNode(html);
      const { shadow } = mountEmbedHost(html);
      const target = shadow.querySelector("div.card")!;
      selectElement(target, shadow, html);

      render(<EmbedElementProperties />);
      await flushRaf();

      const typographySection = getSection("Typography");
      fireEvent.click(within(typographySection).getByTitle("Bind to variable"));
      fireEvent.click(within(typographySection).getByText("--brand-500"));

      expect(currentHtml()).toContain("color: var(--brand-500");
    });

    it("unbinding the text color writes the literal color resolved for the active theme", async () => {
      const variable: Variable = {
        id: "var-brand",
        name: "--brand-500",
        type: "color",
        value: "#112233",
      };
      useVariableStore.getState().setVariables([variable]);
      // Fallback is load-bearing here, same reason as the Fill unbind test
      // above: happy-dom cannot resolve `var()` on its own.
      const html = `<div class="card" style="color:var(--brand-500, #112233);">hi</div>`;
      seedEmbedNode(html);
      const { shadow } = mountEmbedHost(html);
      const target = shadow.querySelector("div.card")!;
      selectElement(target, shadow, html);

      render(<EmbedElementProperties />);
      await flushRaf();

      const typographySection = getSection("Typography");
      fireEvent.click(within(typographySection).getByTitle("Unbind variable"));

      const lower = currentHtml().toLowerCase();
      expect(lower).not.toContain("var(--brand-500");
      expect(lower).toContain(variable.value.toLowerCase());
    });
  });

  describe("variable binding", () => {
    function seedColorVariable(): Variable {
      const variable: Variable = {
        id: "var-brand",
        name: "--brand-500",
        type: "color",
        value: "#112233",
      };
      useVariableStore.getState().setVariables([variable]);
      return variable;
    }

    it("binding Fill to a color variable writes background-color: var(--name)", async () => {
      seedColorVariable();
      const html = `<div class="card" style="background-color:#ff0000;">hi</div>`;
      seedEmbedNode(html);
      const { shadow } = mountEmbedHost(html);
      const target = shadow.querySelector("div.card")!;
      selectElement(target, shadow, html);

      render(<EmbedElementProperties />);
      await flushRaf();

      const fillSection = getSection("Fill");
      fireEvent.click(within(fillSection).getByTitle("Bind to variable"));
      fireEvent.click(within(fillSection).getByText("--brand-500"));

      expect(currentHtml()).toContain("background-color: var(--brand-500");
    });

    it("binding Stroke to a color variable writes a solid border referencing the variable", async () => {
      seedColorVariable();
      const html = `<div class="card" style="border: 1px solid #333333;">hi</div>`;
      seedEmbedNode(html);
      const { shadow } = mountEmbedHost(html);
      const target = shadow.querySelector("div.card")!;
      selectElement(target, shadow, html);

      render(<EmbedElementProperties />);
      await flushRaf();

      const strokeSection = getSection("Stroke");
      fireEvent.click(within(strokeSection).getByTitle("Bind to variable"));
      fireEvent.click(within(strokeSection).getByText("--brand-500"));

      // Loosely-scoped on purpose: `generateVisualStyles` legitimately
      // produces a single `border: "1px solid var(--brand-500, #333333)"`
      // declaration here (verified by reading the generator directly), but
      // happy-dom's own `CSSStyleDeclaration` shorthand parser doesn't
      // understand `var()` inside `border` and re-explodes it into
      // border-width/style/color longhands, each holding the raw string —
      // a test-environment quirk, not a product bug (see this test file's
      // note in the final report). Assert the fact that matters: the
      // variable reference reaches `htmlContent` at all.
      expect(currentHtml().toLowerCase()).toContain("var(--brand-500");
    });

    it("unbinding a variable writes the literal color resolved for the active theme", async () => {
      const variable = seedColorVariable();
      // The fallback in the `var()` reference is load-bearing here: happy-dom
      // has no CSS custom-property resolution engine, so with no fallback
      // `getComputedStyle` can't resolve a color at all and the read side
      // (`applyBaseProps`) never populates a fill to bind onto. A real
      // browser resolves an *undeclared* custom property to the property's
      // initial value regardless — this bridge's own write path
      // (`resolveBindingToCssVar`) always includes a fallback for exactly
      // this reason, so a round-tripped document always has one too.
      const html = `<div class="card" style="background-color:var(--brand-500, #112233);">hi</div>`;
      seedEmbedNode(html);
      const { shadow } = mountEmbedHost(html);
      const target = shadow.querySelector("div.card")!;
      selectElement(target, shadow, html);

      render(<EmbedElementProperties />);
      await flushRaf();

      const fillSection = getSection("Fill");
      // Bound state renders an "Unbind variable" button in place of the swatch/input.
      fireEvent.click(within(fillSection).getByTitle("Unbind variable"));

      expect(currentHtml().toLowerCase()).not.toContain("var(--brand-500");
      expect(currentHtml().toLowerCase()).toContain(variable.value.toLowerCase());
    });
  });
});
