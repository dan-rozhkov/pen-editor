import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { EmbedElementProperties } from "../EmbedElementProperties";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
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

  it("PropertiesPanel shows the normal embed editor when there is no element selection", () => {
    const html = `<div class="card">hi</div>`;
    seedEmbedNode(html);
    mountEmbedHost(html);
    // No selectElement() call.

    render(<PropertiesPanel />);

    expect(screen.queryByRole("button", { name: "Back to embed" })).toBeNull();
  });
});
