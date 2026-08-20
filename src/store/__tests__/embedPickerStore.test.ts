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
    expect(s.selection).toBeNull();
  });

  it("startPicking sets pickingEmbedId and clears hover", () => {
    useEmbedPickerStore.getState().setHoveredPath("p:nth-of-type(1)");
    useEmbedPickerStore.getState().startPicking("e1");
    const s = useEmbedPickerStore.getState();
    expect(s.pickingEmbedId).toBe("e1");
    expect(s.hoveredPath).toBeNull();
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

  it("stopPicking clears pickingEmbedId and hoveredPath but keeps selection", () => {
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().setHoveredPath("p:nth-of-type(1)");
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    useEmbedPickerStore.getState().stopPicking();
    const s = useEmbedPickerStore.getState();
    expect(s.pickingEmbedId).toBeNull();
    expect(s.hoveredPath).toBeNull();
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

  it("reset clears everything", () => {
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().setHoveredPath("p:nth-of-type(1)");
    useEmbedPickerStore.getState().selectElement(selectionFor("e1"));
    useEmbedPickerStore.getState().reset();
    const s = useEmbedPickerStore.getState();
    expect(s.pickingEmbedId).toBeNull();
    expect(s.hoveredPath).toBeNull();
    expect(s.selection).toBeNull();
  });
});
