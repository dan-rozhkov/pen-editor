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
