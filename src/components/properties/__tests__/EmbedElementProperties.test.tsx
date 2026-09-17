import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { EmbedElementProperties } from "../EmbedElementProperties";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { resetStores } from "@/test/fixtures";
import { describeEmbedElement, buildElementPath } from "@/lib/embedElementPicker";
import { mountHtmlWithBodyStyles } from "@/utils/embedHtmlUtils";
import type { EmbedNode } from "@/types/scene";

// Same rationale as embedElementStyle.test.ts: DOMPurify's tag walk is a
// no-op against happy-dom's DOMParser document, so `mountHtmlWithBodyStyles`
// (called unconditionally) is stubbed to the identity function here too.
vi.mock("@/utils/sanitizeEmbedHtml", () => ({
  sanitizeEmbedHtml: (html: string) => html,
}));

// `ColorInput`'s variable-bind menu is a base-ui `DropdownMenu`, which
// portals and is flaky to drive open in happy-dom (same rationale
// FillSection.test.tsx documents for its own dropdown-menu mock). Render the
// trigger/content inline instead, so the "Bind to variable" menu items are
// always in the DOM.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: ComponentProps<"div">) => <div {...props}>{children}</div>,
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

/** Scope queries to one PropertySection by its title text (sections have no
 * accessible region role, just a styled title `<div>`), since several
 * sections repeat the same field labels ("W", displayed "0", etc). */
function getSection(title: string): HTMLElement {
  return screen.getByText(title).closest(".relative.border-b") as HTMLElement;
}

describe("<EmbedElementProperties />", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("renders values read from the live element", async () => {
    const html = `<div class="card" style="display:flex;padding:4px 8px 4px 8px;background-color:rgb(255,0,0);font-size:14px;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    expect(screen.getByText("div.card")).toBeTruthy();
    expect(screen.getByDisplayValue("14")).toBeTruthy(); // font-size
    expect(screen.getByDisplayValue("#FF0000")).toBeTruthy(); // background color hex
  });

  it("edits a number field, writes new htmlContent, and keeps selection alive", async () => {
    const html = `<div class="card" style="font-size:14px;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const fontSizeInput = screen.getByDisplayValue("14");
    fireEvent.change(fontSizeInput, { target: { value: "20" } });

    const updatedHtml = (useSceneStore.getState().nodesById[EMBED_ID] as EmbedNode).htmlContent;
    expect(updatedHtml).toContain("font-size: 20px");

    // Selection must survive the write — noteSelectionEdit must have run
    // BEFORE updateNode so useEmbedPickerLifecycle's staleness check (which
    // isn't mounted in this test, but the snapshot invariant still holds)
    // never sees a snapshot mismatch.
    const { selection, selectionHtmlSnapshot } = useEmbedPickerStore.getState();
    expect(selection).not.toBeNull();
    expect(selectionHtmlSnapshot).toBe(updatedHtml);
  });

  it("edits the background color and writes the expected CSS declaration", async () => {
    const html = `<div class="card">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const colorInputs = screen.getAllByPlaceholderText("#000000");
    fireEvent.change(colorInputs[0], { target: { value: "#00ff00" } });

    const updatedHtml = (useSceneStore.getState().nodesById[EMBED_ID] as EmbedNode).htmlContent;
    expect(updatedHtml.toLowerCase()).toContain("background-color: #00ff00");
  });

  it("edits the display select and writes the expected CSS declaration", async () => {
    const html = `<div class="card">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    // SelectWithOptions is a Base UI popup select, not a native <select>, and
    // its trigger carries no accessible name — open the FIRST combobox (the
    // Layout section's "Display" select is the first one the panel renders
    // at this point, since flex-only sub-fields aren't shown yet) and pick
    // the option from the portal-rendered listbox.
    fireEvent.click(screen.getAllByRole("combobox")[0]);
    const flexOption = await screen.findByRole("option", { name: "Flex" });
    // Base UI's option `onClick` only commits when a `pointerdown` preceded
    // it on the same element (it tracks that to distinguish a real mouse
    // click from a synthetic one) — a bare `click` is silently ignored.
    fireEvent.pointerDown(flexOption);
    fireEvent.click(flexOption);

    const updatedHtml = (useSceneStore.getState().nodesById[EMBED_ID] as EmbedNode).htmlContent;
    expect(updatedHtml).toContain("display: flex");
  });

  it("edits the element's text content", async () => {
    const html = `<p>old</p>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("p")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const textInput = screen.getByDisplayValue("old");
    fireEvent.change(textInput, { target: { value: "new" } });

    const updatedHtml = (useSceneStore.getState().nodesById[EMBED_ID] as EmbedNode).htmlContent;
    expect(updatedHtml).toContain("<p>new</p>");
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
    // Border color is the second ColorInput in the panel (Fill's is first).
    const strokeColorInput = within(strokeSection).getByPlaceholderText("#000000");
    fireEvent.change(strokeColorInput, { target: { value: "#ff00ff" } });

    const updatedHtml = (useSceneStore.getState().nodesById[EMBED_ID] as EmbedNode).htmlContent;
    const lower = updatedHtml.toLowerCase();
    // The width lives inside the original `border: 2px solid ...` shorthand
    // (CSSOM keeps it as a shorthand when only the color longhand is
    // touched) — so the width survives as "2px" and the old color is gone,
    // rather than the shorthand being exploded into longhands.
    expect(lower).toContain("2px");
    expect(lower).not.toContain("#333333");
    expect(lower).toContain("#ff00ff");
  });

  it("setting a non-zero stroke width on a border-style:none element adds border-style: solid", async () => {
    const html = `<div class="card" style="border-style: none;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const strokeSection = getSection("Stroke");
    const strokeWidthInput = within(strokeSection).getByDisplayValue("0");
    fireEvent.change(strokeWidthInput, { target: { value: "3" } });

    const updatedHtml = (useSceneStore.getState().nodesById[EMBED_ID] as EmbedNode).htmlContent;
    expect(updatedHtml.toLowerCase()).toContain("border-width: 3px");
    expect(updatedHtml.toLowerCase()).toContain("border-style: solid");
  });

  it("writes an explicit padding-top: 0px rather than removing the declaration (removal wouldn't override a class)", async () => {
    // Regression: every control in this panel is documented to write an
    // explicit value, never `null`/remove — because embed HTML is styled
    // through classes, and removing an inline declaration that was never
    // there is a no-op (the class value shows through unchanged). Here the
    // element already HAS an inline padding-top the user is nudging to 0;
    // asserting an explicit "0px" (not the declaration vanishing) is what
    // distinguishes "set to zero" from "unset".
    const html = `<div class="card" style="padding-top: 10px;">hi</div>`;
    seedEmbedNode(html);
    const { shadow } = mountEmbedHost(html);
    const target = shadow.querySelector("div.card")!;
    selectElement(target, shadow, html);

    render(<EmbedElementProperties />);
    await flushRaf();

    const padTInput = screen.getByDisplayValue("10");
    fireEvent.change(padTInput, { target: { value: "0" } });

    const updatedHtml = (useSceneStore.getState().nodesById[EMBED_ID] as EmbedNode).htmlContent;
    expect(updatedHtml).toContain("padding-top: 0px");
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

  describe("editor variable binding", () => {
    /** Seeds a color variable with distinct light/dark values, mirroring
     * how the Variables tab creates one. */
    function seedColorVariable(id: string, name: string, light: string, dark: string): void {
      useVariableStore.getState().addVariable({
        id,
        name,
        type: "color",
        value: dark,
        themeValues: { light, dark },
      });
    }

    it("shows a bound background-color as the variable's name, using its active-theme value as the swatch", async () => {
      seedColorVariable("var_brand", "--brand-500", "#112233", "#445566");
      useThemeStore.getState().setActiveTheme("light");
      const html = `<div class="card" style="background-color: var(--brand-500);">hi</div>`;
      seedEmbedNode(html);
      const { shadow } = mountEmbedHost(html);
      const target = shadow.querySelector("div.card")!;
      selectElement(target, shadow, html);

      render(<EmbedElementProperties />);
      await flushRaf();

      // Bound state renders the variable's display name instead of a hex
      // text field — the hex input this suite's other tests query via
      // getByPlaceholderText("#000000") is replaced entirely. Scoped to the
      // Fill section: Stroke/Typography are still unbound and each render
      // their own "--brand-500" bind-menu item.
      expect(within(getSection("Fill")).getByText("--brand-500")).toBeTruthy();
    });

    it("binding a variable through the Fill picker writes var(--name) into htmlContent", async () => {
      seedColorVariable("var_brand", "--brand-500", "#112233", "#445566");
      const html = `<div class="card">hi</div>`;
      seedEmbedNode(html);
      const { shadow } = mountEmbedHost(html);
      const target = shadow.querySelector("div.card")!;
      selectElement(target, shadow, html);

      render(<EmbedElementProperties />);
      await flushRaf();

      const fillSection = getSection("Fill");
      fireEvent.click(within(fillSection).getByTitle("Bind to variable"));
      fireEvent.click(within(fillSection).getByText("--brand-500"));

      const updatedHtml = (useSceneStore.getState().nodesById[EMBED_ID] as EmbedNode).htmlContent;
      expect(updatedHtml).toContain("background-color: var(--brand-500)");

      // Optimistic local patch: the row must flip to "bound" immediately,
      // without waiting for the rAF re-read (patchSnapshotStyle keeps
      // varBindings in lockstep with the written style value).
      expect(within(fillSection).getByText("--brand-500")).toBeTruthy();
    });

    it("binding a variable whose name is a free-form label (\"Color 1\") writes var(--color-1), not the invalid var(--Color 1)", async () => {
      // Mirrors what the Variables panel's `handleAddVariable` actually
      // creates — a human label, not a CSS identifier.
      seedColorVariable("var_c1", "Color 1", "#112233", "#445566");
      const html = `<div class="card">hi</div>`;
      seedEmbedNode(html);
      const { shadow } = mountEmbedHost(html);
      const target = shadow.querySelector("div.card")!;
      selectElement(target, shadow, html);

      render(<EmbedElementProperties />);
      await flushRaf();

      const fillSection = getSection("Fill");
      fireEvent.click(within(fillSection).getByTitle("Bind to variable"));
      // The bind-menu item still shows the human label...
      fireEvent.click(within(fillSection).getByText("Color 1"));

      // ...but the written declaration is the slugified, valid custom
      // property name.
      const updatedHtml = (useSceneStore.getState().nodesById[EMBED_ID] as EmbedNode).htmlContent;
      expect(updatedHtml).toContain("background-color: var(--color-1)");
      expect(updatedHtml).not.toContain("var(--Color 1)");

      // And it reads back as bound (findVariableByName resolves the
      // canonical name back to the same variable), showing the label again.
      expect(within(fillSection).getByText("Color 1")).toBeTruthy();
    });

    it("binding a variable on the Stroke color nudges border-style to solid, same as a literal color pick", async () => {
      seedColorVariable("var_brand", "--brand-500", "#112233", "#445566");
      const html = `<div class="card" style="border-style: none;">hi</div>`;
      seedEmbedNode(html);
      const { shadow } = mountEmbedHost(html);
      const target = shadow.querySelector("div.card")!;
      selectElement(target, shadow, html);

      render(<EmbedElementProperties />);
      await flushRaf();

      const strokeSection = getSection("Stroke");
      fireEvent.click(within(strokeSection).getByTitle("Bind to variable"));
      fireEvent.click(within(strokeSection).getByText("--brand-500"));

      const updatedHtml = (useSceneStore.getState().nodesById[EMBED_ID] as EmbedNode).htmlContent;
      expect(updatedHtml).toContain("border-color: var(--brand-500)");
      expect(updatedHtml).toContain("border-style: solid");
    });

    it("unbinding writes the variable's currently-resolved literal color instead of leaving var(...) behind", async () => {
      seedColorVariable("var_brand", "--brand-500", "#112233", "#445566");
      useThemeStore.getState().setActiveTheme("dark");
      const html = `<div class="card" style="background-color: var(--brand-500);">hi</div>`;
      seedEmbedNode(html);
      const { shadow } = mountEmbedHost(html);
      const target = shadow.querySelector("div.card")!;
      selectElement(target, shadow, html);

      render(<EmbedElementProperties />);
      await flushRaf();

      const fillSection = getSection("Fill");
      fireEvent.click(within(fillSection).getByTitle("Unbind variable"));

      const updatedHtml = (useSceneStore.getState().nodesById[EMBED_ID] as EmbedNode).htmlContent;
      // Active theme is "dark" at unbind time — the dark value must be what
      // gets written, so the element doesn't visually jump.
      expect(updatedHtml.toLowerCase()).toContain("background-color: #445566");
      expect(updatedHtml).not.toContain("var(");
    });

    it("an unresolvable binding (variable deleted from the Variables tab) falls back to the plain, unbound color UI", async () => {
      // No seedColorVariable() call — `color: var(--gone)` names a custom
      // property no color variable defines. `findVariableByName` can't
      // resolve it, so the row can't offer "Unbind" for something it can't
      // identify — it renders as an ordinary unbound color field instead
      // (computed color resolves to "" for an unresolvable var()), which is
      // itself the "clears to nothing to bind against" half of the contract.
      const html = `<div class="card" style="color: var(--gone);">hi</div>`;
      seedEmbedNode(html);
      const { shadow } = mountEmbedHost(html);
      const target = shadow.querySelector("div.card")!;
      selectElement(target, shadow, html);

      render(<EmbedElementProperties />);
      await flushRaf();

      const typographySection = getSection("Typography");
      expect(within(typographySection).queryByTitle("Unbind variable")).toBeNull();
    });
  });
});
