import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyDownHandlerDeps } from "../keyboardCommands";
import { handleEmbedElementEnter } from "../embedElementNavigation";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { usePenToolStore } from "@/store/penToolStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { describeEmbedElement, resolveElementPath } from "@/lib/embedElementPicker";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";
import { key, seedEmbedNode, setupKeyDownHandler } from "./keyboardCommandFixtures";

/**
 * Mirrors `mountHtmlWithBodyStyles`'s UNWRAPPED branch (no body-targeted
 * styles), exactly like `embedElementNavigation.test.ts`'s own
 * `makeShadowRoot` helper: a shadow root whose sole child is the mount
 * container `<div>`, with `html` mounted directly into it. Attached under a
 * `[data-embed-id]` host so `findEmbedShadowRoot` (used by the handlers
 * under test) can find it the same way it does in production.
 */
function mountEmbed(embedId: string, html: string): ShadowRoot {
  const host = document.createElement("div");
  host.setAttribute("data-embed-id", embedId);
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  container.innerHTML = html;
  shadow.appendChild(container);
  return shadow;
}

/** Seeds a single embed node as the sole scene node/selection — the
 * precondition every handler under test requires (`resolveElementContext`'s
 * "owning embed is still the sole native selection" check). */
function seedEmbedSelection(embedId: string, html: string): void {
  seedEmbedNode(embedId, html);
  useSelectionStore.setState({ selectedIds: [embedId] });
}

/** Programmatically picks `el`, exactly the way `LayerItem`'s click handler
 * does (`selectElement(describeEmbedElement(...), html)`) — see that
 * component's doc comment for why the html snapshot argument matters. */
function pick(embedId: string, root: ShadowRoot, el: Element, html: string): void {
  useEmbedPickerStore.getState().selectElement(describeEmbedElement(el, root, embedId), html);
}

function tabEvent(shiftKey = false): KeyboardEvent {
  return key("Tab", { shiftKey });
}

function enterEvent(shiftKey = false): KeyboardEvent {
  return key("Enter", { shiftKey });
}

/** Resolves `useEmbedPickerStore`'s current `selection.path` back to a live
 * element, so assertions compare actual DOM identity rather than opaque
 * path strings (which would also pass for a subtly-wrong path that happens
 * to resolve to nothing, if compared as text instead). */
function currentSelectionElement(root: ShadowRoot): Element | null {
  const selection = useEmbedPickerStore.getState().selection;
  return selection ? resolveElementPath(root, selection.path) : null;
}

const EMBED_HTML =
  "<header>Header</header><section><p>First</p><p>Second</p></section><footer>Footer</footer>";

describe("keyboardCommands — embed element keyboard navigation", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    resetStores();
    document.body.innerHTML = "";
    ({ deps, handler } = setupKeyDownHandler());
  });

  it("Pen tool: Enter finishes an in-progress draft instead of auto-picking a sole-selected embed (Finding 1)", () => {
    // Nothing about starting/continuing a pen draft clears the scene
    // selection, so an embed selected before switching to the pen tool
    // stays the sole selection for the whole draft — this reproduces
    // "select embed, press P, place two points, press Enter" and asserts
    // Enter finishes the draft rather than being swallowed by
    // `handleEmbedElementEnter()`'s auto-start-picking branch.
    const shadow = mountEmbed("e1", EMBED_HTML);
    seedEmbedSelection("e1", EMBED_HTML);
    useDrawModeStore.getState().setActiveTool("pen");
    usePenToolStore.getState().startDraft();
    expect(usePenToolStore.getState().isDrafting).toBe(true);

    handler(enterEvent());

    // The draft was finished (and, with zero anchors, silently discarded —
    // see `finishPenDraft`) and the pen tool exited.
    expect(usePenToolStore.getState().isDrafting).toBe(false);
    expect(useDrawModeStore.getState().activeTool).toBeNull();
    // The embed-element handler never ran: no pick was created on the
    // still-selected embed.
    expect(useEmbedPickerStore.getState().selection).toBeNull();
    expect(currentSelectionElement(shadow)).toBeNull();
  });

  it("Enter on a sole-selected embed with no pick selects the first top-level element", () => {
    const shadow = mountEmbed("e1", EMBED_HTML);
    seedEmbedSelection("e1", EMBED_HTML);
    const header = shadow.querySelector("header")!;

    handler(enterEvent());

    expect(currentSelectionElement(shadow)).toBe(header);
    expect(useEmbedPickerStore.getState().selectionHtmlSnapshot).toBe(EMBED_HTML);
    expect(deps.clearSelection).not.toHaveBeenCalled();
  });

  it("Enter does not auto-start picking on a sole-selected embed while its inline HTML editor is open", () => {
    const shadow = mountEmbed("e1", EMBED_HTML);
    seedEmbedSelection("e1", EMBED_HTML);
    useSelectionStore.setState({ editingMode: "embed", editingNodeId: "e1" });

    handler(enterEvent());

    // No pick was created — the key falls through to whatever native Enter
    // handling applies to an ordinary node (irrelevant here; the point is
    // this handler didn't start picking).
    expect(useEmbedPickerStore.getState().selection).toBeNull();
    expect(currentSelectionElement(shadow)).toBeNull();
  });

  it("Enter does not auto-start picking on a sole-selected embed in an active-embed (interact) mode", () => {
    mountEmbed("e1", EMBED_HTML);
    seedEmbedSelection("e1", EMBED_HTML);
    useSelectionStore.setState({ activeEmbedId: "e1" });

    handler(enterEvent());

    expect(useEmbedPickerStore.getState().selection).toBeNull();
  });

  it("handleEmbedElementEnter does not auto-start picking on a sole-selected embed in a read-only mode", () => {
    // Called directly rather than through `handler`/`createKeyDownHandler`:
    // `keyboardCommands.ts`'s own read-only allowlist already blocks a
    // plain (non-Shift) Enter from reaching this handler at all in view
    // mode today, so routing through it wouldn't exercise this guard — see
    // `requestElementEdit`'s own doc comment in `EmbedLayer.tsx` for why the
    // guard belongs here regardless of what currently gates it upstream.
    mountEmbed("e1", EMBED_HTML);
    seedEmbedSelection("e1", EMBED_HTML);
    useEditorModeStore.setState({ mode: "view", presentFrameIds: [], presentIndex: 0 });

    const handled = handleEmbedElementEnter();

    expect(handled).toBe(false);
    expect(useEmbedPickerStore.getState().selection).toBeNull();

    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
  });

  it("Enter on an element with children selects the first navigable child", () => {
    const shadow = mountEmbed("e1", EMBED_HTML);
    seedEmbedSelection("e1", EMBED_HTML);
    const section = shadow.querySelector("section")!;
    const first = shadow.querySelector("p")!;
    pick("e1", shadow, section, EMBED_HTML);

    handler(enterEvent());

    expect(currentSelectionElement(shadow)).toBe(first);
  });

  it("Enter on a text leaf calls requestElementEdit with the picked path and leaves the selection in place", () => {
    const shadow = mountEmbed("e1", EMBED_HTML);
    seedEmbedSelection("e1", EMBED_HTML);
    const firstP = shadow.querySelectorAll("p")[0];
    pick("e1", shadow, firstP, EMBED_HTML);
    const requestElementEdit = vi.fn(() => true);
    useEmbedPickerStore.getState().setRequestElementEdit(requestElementEdit);
    const pickedPath = useEmbedPickerStore.getState().selection!.path;

    handler(enterEvent());

    expect(requestElementEdit).toHaveBeenCalledWith(pickedPath);
    expect(currentSelectionElement(shadow)).toBe(firstP);
  });

  it("Enter on a text leaf falls back to descending when requestElementEdit declines (and no-ops when there's nowhere to descend)", () => {
    const shadow = mountEmbed("e1", EMBED_HTML);
    seedEmbedSelection("e1", EMBED_HTML);
    const firstP = shadow.querySelectorAll("p")[0];
    pick("e1", shadow, firstP, EMBED_HTML);
    useEmbedPickerStore.getState().setRequestElementEdit(() => false);

    handler(enterEvent());

    // <p>First</p> has no navigable element children, so the selection is
    // left unchanged — but the key was still fully consumed (no native
    // Enter handling ran).
    expect(currentSelectionElement(shadow)).toBe(firstP);
  });

  it("Enter on a non-text-leaf element that collapses to a text row does not descend into an inline child with no layers row", () => {
    // <div>Label <span class="badge">3</span></div>`: `isTextLeaf` says
    // false (the span carries text), so this exercises the descend branch;
    // but the layers tree collapses the div to ONE text row (span is
    // purely INLINE_TAGS), so there is no row for the span to land on.
    const html = `<div>Label <span class="badge">3</span></div>`;
    const shadow = mountEmbed("e1", html);
    seedEmbedSelection("e1", html);
    // `mountEmbed`'s own wrapper is itself a `<div>` (the mount container),
    // so the CONTENT div — the one this test cares about — is the span's
    // parent, not `shadow.querySelector("div")` (which would find the
    // container instead of the nested content div).
    const div = shadow.querySelector("span")!.parentElement!;
    pick("e1", shadow, div, html);

    handler(enterEvent());

    // Selection stays on the div — Enter was still consumed (no fall-through
    // to native path-edit handling), just with nowhere useful to descend to.
    expect(currentSelectionElement(shadow)).toBe(div);
  });

  it("Tab moves to the next sibling and wraps around; Shift+Tab moves backward", () => {
    const shadow = mountEmbed("e1", EMBED_HTML);
    seedEmbedSelection("e1", EMBED_HTML);
    const header = shadow.querySelector("header")!;
    const section = shadow.querySelector("section")!;
    const footer = shadow.querySelector("footer")!;
    pick("e1", shadow, header, EMBED_HTML);

    handler(tabEvent());
    expect(currentSelectionElement(shadow)).toBe(section);

    handler(tabEvent());
    expect(currentSelectionElement(shadow)).toBe(footer);

    handler(tabEvent());
    expect(currentSelectionElement(shadow)).toBe(header);

    handler(tabEvent(true));
    expect(currentSelectionElement(shadow)).toBe(footer);
  });

  it("Tab is consumed even with nowhere to go, never falling through to native sibling navigation", () => {
    const html = "<div><p>only</p></div>";
    const shadow = mountEmbed("e1", html);
    seedEmbedSelection("e1", html);
    const only = shadow.querySelector("p")!;
    pick("e1", shadow, only, html);

    handler(tabEvent());

    // The picked element selection is untouched, and native
    // `selectionStore.select` never ran on some unrelated sibling of the
    // embed node itself.
    expect(currentSelectionElement(shadow)).toBe(only);
    expect(useSelectionStore.getState().selectedIds).toEqual(["e1"]);
  });

  it("Tab/Shift+Tab jump to the first/last navigable sibling when the picked element itself isn't navigable", () => {
    // The layers panel still shows a display:none row as a clickable
    // selection target (flagged hidden, never dropped) — this reproduces
    // picking one of those, then pressing Tab/Shift+Tab from it.
    const html = `<div><p style="display: none">A</p><p>B</p><p>C</p></div>`;
    const shadow = mountEmbed("e1", html);
    seedEmbedSelection("e1", html);
    const [a, b, c] = Array.from(shadow.querySelectorAll("p"));
    pick("e1", shadow, a, html);

    handler(tabEvent());
    expect(currentSelectionElement(shadow)).toBe(b);

    pick("e1", shadow, a, html);
    handler(tabEvent(true));
    expect(currentSelectionElement(shadow)).toBe(c);
  });

  it("Tab releases to native sibling navigation when the picked element isn't navigable and has no navigable siblings", () => {
    const html = `<div><p style="display: none">only</p></div>`;
    const shadow = mountEmbed("e1", html);
    seedEmbedSelection("e1", html);
    const hidden = shadow.querySelector("p")!;
    pick("e1", shadow, hidden, html);

    handler(tabEvent());

    // Nothing inside the embed to move to — the picked selection is
    // untouched, and the key was released rather than eaten (native
    // `handleTabNavigation` ran and no-opped on the sole root node, same as
    // the "no pick" test below).
    expect(currentSelectionElement(shadow)).toBe(hidden);
    expect(useSelectionStore.getState().selectedIds).toEqual(["e1"]);
  });

  it("Shift+Enter selects the parent element", () => {
    const shadow = mountEmbed("e1", EMBED_HTML);
    seedEmbedSelection("e1", EMBED_HTML);
    const section = shadow.querySelector("section")!;
    const first = shadow.querySelector("p")!;
    pick("e1", shadow, first, EMBED_HTML);

    handler(enterEvent(true));

    expect(currentSelectionElement(shadow)).toBe(section);
  });

  it("Shift+Enter at the top level clears the element pick back to the embed node", () => {
    const shadow = mountEmbed("e1", EMBED_HTML);
    seedEmbedSelection("e1", EMBED_HTML);
    const header = shadow.querySelector("header")!;
    pick("e1", shadow, header, EMBED_HTML);

    handler(enterEvent(true));

    expect(useEmbedPickerStore.getState().selection).toBeNull();
    // The embed node itself stays selected — only the element pick is
    // dropped, mirroring native Shift+Enter's "select the parent" which
    // never deselects when there's no parent frame either.
    expect(useSelectionStore.getState().selectedIds).toEqual(["e1"]);
  });

  it("no-ops (returns false, native handling unaffected) with an ordinary node selected and no pick", () => {
    useSceneStore.setState({
      nodesById: {
        n1: {
          id: "n1",
          type: "rect",
          name: "R",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        } as unknown as FlatSceneNode,
      },
      parentById: { n1: null },
      childrenById: {},
      rootIds: ["n1"],
    });
    useSelectionStore.setState({ selectedIds: ["n1"] });

    // Falls through to native handleTabNavigation (a no-op here too: the
    // sole root node has no siblings) — the point is the embed handler
    // never hijacks the event when there's neither a pick nor an embed.
    handler(tabEvent());
    expect(useSelectionStore.getState().selectedIds).toEqual(["n1"]);

    // Falls through to handleEnterEditing, which no-ops for a non-text node.
    handler(enterEvent());
    expect(useEmbedPickerStore.getState().selection).toBeNull();
    expect(useSelectionStore.getState().selectedIds).toEqual(["n1"]);
  });
});
