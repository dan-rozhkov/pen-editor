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

/** Scope queries to one PropertySection by its title text (sections have no
 * accessible region role, just a styled title `<div>`), since several
 * sections repeat the same field labels ("W", displayed "0", etc). */
function getSection(title: string): HTMLElement {
  return screen.getByText(title, { exact: true }).closest(".relative.border-b") as HTMLElement;
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

  it("does not render the Stroke Align control for an embed element (CSS has no border-alignment concept, and reading it back never survives an embed's own box-sizing reset)", async () => {
    const html = `<div class="card" style="border:1px solid #dddddd;box-sizing:border-box;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const strokeSection = getSection("Stroke");
    expect(within(strokeSection).queryByText("Align", { exact: true })).toBeNull();
  });

  it("editing stroke width and color via the embed panel still reaches htmlContent, with no Align control involved", async () => {
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

    let lower = currentHtml().toLowerCase();
    expect(lower).toContain("2px");
    expect(lower).toContain("#ff00ff");

    const weightInput = within(getSection("Stroke")).getByDisplayValue("2");
    fireEvent.change(weightInput, { target: { value: "5" } });

    lower = currentHtml().toLowerCase();
    expect(lower).toContain("5px");
  });

  it("never writes an inline box-sizing declaration for any stroke edit (Inside/Center/Outside is no longer expressible from this panel)", async () => {
    // This was the source of the original bug class: writing an Align value
    // meant writing `box-sizing`, and reading it back off an embed's
    // near-universal `* { box-sizing: border-box }` class reset was
    // fundamentally ambiguous. With the Align control removed, no code path
    // in this panel ever produces a `box-sizing` declaration at all —
    // checked across add/recolor/reweight/remove, the whole lifecycle of a
    // stroke edit. Starts with NO inline `box-sizing` at all (unlike an
    // author-authored one, which this bridge now leaves alone either way,
    // since it no longer has any opinion about the property).
    const html = `<div class="card" style="border:1px solid #dddddd;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const strokeSection = getSection("Stroke");
    const strokeColorInput = within(strokeSection).getByPlaceholderText("#000000");
    fireEvent.change(strokeColorInput, { target: { value: "#00ff00" } });
    expect(currentHtml().toLowerCase()).not.toContain("box-sizing");

    const weightInput = within(getSection("Stroke")).getByDisplayValue("1");
    fireEvent.change(weightInput, { target: { value: "0" } });
    expect(currentHtml().toLowerCase()).not.toContain("box-sizing");

    fireEvent.click(screen.getByRole("button", { name: "Remove stroke" }));
    expect(currentHtml().toLowerCase()).not.toContain("box-sizing");
  });

  it("leaves an author-authored inline box-sizing untouched by a stroke edit (the bridge no longer has any opinion about this property)", async () => {
    const html = `<div class="card" style="border:1px solid #dddddd;box-sizing:border-box;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const strokeSection = getSection("Stroke");
    const strokeColorInput = within(strokeSection).getByPlaceholderText("#000000");
    fireEvent.change(strokeColorInput, { target: { value: "#00ff00" } });

    expect(currentHtml().toLowerCase()).toContain("box-sizing: border-box");
  });

  describe("outline-sourced stroke edits never leave a second, stale outline (bug repro)", () => {
    // `applyOutlineStroke` (`embedElementNode.ts`) reads an author-set
    // `outline` into `node.stroke`/`strokeWidth` but always renders it back
    // as `border` (no `strokeAlign` is ever set — see its doc comment). Two
    // consequences the panel used to get wrong, reproduced end-to-end
    // through `commitPatch` here (not just the pure diff, in
    // `embedElementNode.test.ts`):
    // 1. editing weight/color wrote a new `border` NEXT TO the still-live
    //    `outline`, so the element visibly had two strokes.
    // 2. "Remove stroke" wrote `border: none` but never touched `outline`,
    //    so the stroke kept rendering and the next re-read pulled it right
    //    back out of the still-live outline — the control looked dead.

    it("editing the stroke color resets the live outline instead of stacking a border next to it", async () => {
      const html = `<div class="card" style="outline: 2px solid #333333;">hi</div>`;
      seedEmbedNode(html);
      const { shadow } = mountEmbedHost(html);
      const target = shadow.querySelector("div.card")!;
      selectElement(target, shadow, html);

      render(<EmbedElementProperties />);
      await flushRaf();

      // Asserted on the actual `edit.styles` patch handed to
      // `applyEmbedElementEdit`, not a live-DOM re-read: happy-dom's own
      // `CSSStyleDeclaration` mangles a `none` shorthand it is given for
      // `border`/`outline` into malformed longhands (`outline-color: none`,
      // `border: none none`, ...) on `setProperty`, which is a happy-dom
      // quirk, not something this bridge writes — see the real-browser e2e
      // spec (`e2e/embed-element-properties.spec.ts`) for byte-accurate
      // confirmation of what actually lands in `htmlContent`.
      const applySpy = vi.spyOn(embedElementStyle, "applyEmbedElementEdit");

      const strokeSection = getSection("Stroke");
      const strokeColorInput = within(strokeSection).getByPlaceholderText("#000000");
      fireEvent.change(strokeColorInput, { target: { value: "#ff00ff" } });

      const lastEditArg = applySpy.mock.calls.at(-1)?.[2];
      expect(lastEditArg?.styles).toMatchObject({
        border: "2px solid #ff00ff",
        // The original outline must be explicitly reset, not left live —
        // this is the actual bug fix: without it, `styles` here would have
        // no `outline` key at all, and the live outline keeps painting a
        // second stroke beside the new inline border.
        outline: "none",
      });
    });

    it("editing the stroke weight resets the live outline too", async () => {
      const html = `<div class="card" style="outline: 2px solid #333333;">hi</div>`;
      seedEmbedNode(html);
      const { shadow } = mountEmbedHost(html);
      const target = shadow.querySelector("div.card")!;
      selectElement(target, shadow, html);

      render(<EmbedElementProperties />);
      await flushRaf();

      const applySpy = vi.spyOn(embedElementStyle, "applyEmbedElementEdit");

      const weightInput = within(getSection("Stroke")).getByDisplayValue("2");
      fireEvent.change(weightInput, { target: { value: "6" } });

      const lastEditArg = applySpy.mock.calls.at(-1)?.[2];
      expect(lastEditArg?.styles).toMatchObject({
        border: "6px solid #333333",
        outline: "none",
      });
    });

    it("removing an outline-sourced stroke actually removes it, and does not resurrect it on the next read", async () => {
      const html = `<div class="card" style="outline: 2px solid #333333;">hi</div>`;
      seedEmbedNode(html);
      const { shadow } = mountEmbedHost(html);
      const target = shadow.querySelector("div.card")!;
      selectElement(target, shadow, html);

      render(<EmbedElementProperties />);
      await flushRaf();

      const applySpy = vi.spyOn(embedElementStyle, "applyEmbedElementEdit");

      fireEvent.click(screen.getByRole("button", { name: "Remove stroke" }));

      const lastEditArg = applySpy.mock.calls.at(-1)?.[2];
      expect(lastEditArg?.styles).toMatchObject({
        border: "none",
        // Without this, the diff alone has no way to know a live `outline`
        // is what's still painting the "removed" stroke — the control would
        // look dead, and the next re-read would pull the stroke right back
        // out of the untouched outline.
        outline: "none",
      });

      const written = currentHtml();
      expect(written.toLowerCase()).not.toContain("#333333");

      // Re-read straight off the just-written HTML (what the rAF re-read in
      // `EmbedElementProperties` would build next) and confirm the stroke
      // genuinely stays gone — not resurrected from a live outline the first
      // write forgot to clear.
      cleanup();
      document.body.innerHTML = "";
      seedEmbedNode(written);
      const { shadow: shadow2 } = mountEmbedHost(written);
      const target2 = shadow2.querySelector("div.card")!;
      selectElement(target2, shadow2, written);
      render(<EmbedElementProperties />);
      await flushRaf();

      expect(screen.getByRole("button", { name: "Add stroke" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Remove stroke" })).toBeNull();
    });
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
