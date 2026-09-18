import { describe, it, expect, beforeEach } from "vitest";
import { useEmbedPickerStore } from "../embedPickerStore";
import type { EmbedElementSelection } from "@/lib/embedElementPicker";

function selectionFor(embedId: string): EmbedElementSelection {
  return {
    embedId,
    path: "div:nth-of-type(1)",
    tagName: "div",
    classes: [],
    textPreview: "hi",
    outerHtml: "<div>hi</div>",
  };
}

describe("embedPickerStore", () => {
  beforeEach(() => useEmbedPickerStore.getState().reset());

  it("defaults to no picking, no hover, no selection", () => {
    const s = useEmbedPickerStore.getState();
    expect(s.pickingEmbedId).toBeNull();
    expect(s.hoveredPath).toBeNull();
    expect(s.hoveredEmbedId).toBeNull();
    expect(s.selection).toBeNull();
  });

  it("setHoveredElement sets hoveredEmbedId and hoveredPath together", () => {
    useEmbedPickerStore.getState().setHoveredElement("e1", "span:nth-of-type(1)");
    const s = useEmbedPickerStore.getState();
    expect(s.hoveredEmbedId).toBe("e1");
    expect(s.hoveredPath).toBe("span:nth-of-type(1)");
  });

  it("setHoveredElement(null, null) clears both fields", () => {
    useEmbedPickerStore.getState().setHoveredElement("e1", "span:nth-of-type(1)");
    useEmbedPickerStore.getState().setHoveredElement(null, null);
    const s = useEmbedPickerStore.getState();
    expect(s.hoveredEmbedId).toBeNull();
    expect(s.hoveredPath).toBeNull();
  });

  it("setHoveredPath alone does not touch hoveredEmbedId", () => {
    useEmbedPickerStore.getState().setHoveredElement("e1", "span:nth-of-type(1)");
    useEmbedPickerStore.getState().setHoveredPath("div:nth-of-type(2)");
    const s = useEmbedPickerStore.getState();
    expect(s.hoveredEmbedId).toBe("e1");
    expect(s.hoveredPath).toBe("div:nth-of-type(2)");
  });

  it("startPicking sets pickingEmbedId and clears hover", () => {
    useEmbedPickerStore.getState().setHoveredElement("other-embed", "p:nth-of-type(1)");
    useEmbedPickerStore.getState().startPicking("e1");
    const s = useEmbedPickerStore.getState();
    expect(s.pickingEmbedId).toBe("e1");
    expect(s.hoveredPath).toBeNull();
    expect(s.hoveredEmbedId).toBeNull();
  });

  it("startPicking on the same embed keeps an existing selection for it", () => {
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    useEmbedPickerStore.getState().startPicking("e1");
    expect(useEmbedPickerStore.getState().selection?.embedId).toBe("e1");
  });

  it("startPicking on a different embed clears a selection belonging to another embed", () => {
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    useEmbedPickerStore.getState().startPicking("e2");
    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e2");
    expect(useEmbedPickerStore.getState().selection).toBeNull();
  });

  it("startPicking on a different embed clears an existing hover", () => {
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().setHoveredPath("p:nth-of-type(1)");
    useEmbedPickerStore.getState().startPicking("e2");
    expect(useEmbedPickerStore.getState().hoveredPath).toBeNull();
  });

  it("stopPicking clears pickingEmbedId, hover state, but keeps selection", () => {
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().setHoveredElement("e1", "p:nth-of-type(1)");
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    useEmbedPickerStore.getState().stopPicking();
    const s = useEmbedPickerStore.getState();
    expect(s.pickingEmbedId).toBeNull();
    expect(s.hoveredPath).toBeNull();
    expect(s.hoveredEmbedId).toBeNull();
    expect(s.selection?.embedId).toBe("e1");
  });

  it("setHoveredPath sets and clears the hovered path", () => {
    useEmbedPickerStore.getState().setHoveredPath("span:nth-of-type(1)");
    expect(useEmbedPickerStore.getState().hoveredPath).toBe("span:nth-of-type(1)");
    useEmbedPickerStore.getState().setHoveredPath(null);
    expect(useEmbedPickerStore.getState().hoveredPath).toBeNull();
  });

  it("clearSelection only clears the selection", () => {
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    useEmbedPickerStore.getState().clearSelection();
    const s = useEmbedPickerStore.getState();
    expect(s.selection).toBeNull();
    expect(s.pickingEmbedId).toBe("e1");
  });

  it("noteSelectionEdit is a no-op when there is no selection", () => {
    useEmbedPickerStore.getState().noteSelectionEdit("<div>new</div>");
    const s = useEmbedPickerStore.getState();
    expect(s.selection).toBeNull();
    expect(s.selectionHtmlSnapshot).toBeNull();
  });

  it("noteSelectionEdit updates the snapshot and outerHtml without touching other selection fields", () => {
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"), "<div>hi</div>");
    useEmbedPickerStore.getState().noteSelectionEdit("<div>edited</div>", "<div>edited</div>");
    const s = useEmbedPickerStore.getState();
    expect(s.selectionHtmlSnapshot).toBe("<div>edited</div>");
    expect(s.selection).toEqual({
      ...selectionFor("e1"),
      outerHtml: "<div>edited</div>",
    });
  });

  it("noteSelectionEdit updates the snapshot alone when outerHtml is omitted", () => {
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"), "<div>hi</div>");
    useEmbedPickerStore.getState().noteSelectionEdit("<div>edited</div>");
    const s = useEmbedPickerStore.getState();
    expect(s.selectionHtmlSnapshot).toBe("<div>edited</div>");
    expect(s.selection?.outerHtml).toBe("<div>hi</div>");
  });

  it("noteSelectionEdit truncates a long outerHtml the same way describeEmbedElement does", () => {
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"), "<div>hi</div>");
    const longHtml = `<div>${"x".repeat(1300)}</div>`;
    useEmbedPickerStore.getState().noteSelectionEdit("<div>edited</div>", longHtml);
    const outerHtml = useEmbedPickerStore.getState().selection?.outerHtml ?? "";
    expect(outerHtml.length).toBe(1201);
    expect(outerHtml.endsWith("…")).toBe(true);
    expect(outerHtml.startsWith(longHtml.slice(0, 1200))).toBe(true);
  });

  // A sortable reorder changes the element's `nth-of-type` position among
  // its siblings, so the OLD path would resolve to whatever now sits in the
  // element's former slot instead of the element itself — `newPath` is how
  // `EmbedLayer`'s drag gesture keeps `selection.path` pointing at the right
  // element after a commit.
  it("noteSelectionEdit updates selection.path when newPath is given", () => {
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"), "<div>hi</div>");
    useEmbedPickerStore
      .getState()
      .noteSelectionEdit("<div>edited</div>", "<div>edited</div>", "div:nth-of-type(3)");
    const s = useEmbedPickerStore.getState();
    expect(s.selection?.path).toBe("div:nth-of-type(3)");
    expect(s.selection?.outerHtml).toBe("<div>edited</div>");
  });

  it("noteSelectionEdit leaves selection.path untouched when newPath is omitted", () => {
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"), "<div>hi</div>");
    useEmbedPickerStore.getState().noteSelectionEdit("<div>edited</div>");
    expect(useEmbedPickerStore.getState().selection?.path).toBe("div:nth-of-type(1)");
  });

  it("setDropIndicator sets and clears the indicator rect", () => {
    const rect = { left: 1, top: 2, width: 3, height: 4 };
    useEmbedPickerStore.getState().setDropIndicator(rect);
    expect(useEmbedPickerStore.getState().dropIndicator).toEqual(rect);
    useEmbedPickerStore.getState().setDropIndicator(null);
    expect(useEmbedPickerStore.getState().dropIndicator).toBeNull();
  });

  it("stopPicking clears a live drop indicator", () => {
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().setDropIndicator({ left: 0, top: 0, width: 1, height: 1 });
    useEmbedPickerStore.getState().stopPicking();
    expect(useEmbedPickerStore.getState().dropIndicator).toBeNull();
  });

  it("setRequestElementEdit sets and clears requestElementEdit", () => {
    const request = (_path: string) => true;
    useEmbedPickerStore.getState().setRequestElementEdit(request);
    expect(useEmbedPickerStore.getState().requestElementEdit).toBe(request);
    useEmbedPickerStore.getState().setRequestElementEdit(null);
    expect(useEmbedPickerStore.getState().requestElementEdit).toBeNull();
  });

  it("stopPicking does NOT clear requestElementEdit — mirrors cancelElementDrag/cancelElementEdit, which EmbedLayer's own picking-effect teardown clears instead", () => {
    const request = (_path: string) => true;
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().setRequestElementEdit(request);
    useEmbedPickerStore.getState().stopPicking();
    expect(useEmbedPickerStore.getState().requestElementEdit).toBe(request);
  });

  it("reset clears everything", () => {
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().setHoveredElement("e1", "p:nth-of-type(1)");
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    useEmbedPickerStore.getState().setDropIndicator({ left: 0, top: 0, width: 1, height: 1 });
    useEmbedPickerStore.getState().setRequestElementEdit((_path: string) => true);
    useEmbedPickerStore.getState().reset();
    const s = useEmbedPickerStore.getState();
    expect(s.pickingEmbedId).toBeNull();
    expect(s.hoveredPath).toBeNull();
    expect(s.hoveredEmbedId).toBeNull();
    expect(s.selection).toBeNull();
    expect(s.dropIndicator).toBeNull();
    expect(s.requestElementEdit).toBeNull();
  });
});
