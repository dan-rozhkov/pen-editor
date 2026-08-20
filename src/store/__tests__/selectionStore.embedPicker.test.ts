import { describe, it, expect, beforeEach } from "vitest";
import { useSelectionStore } from "@/store/selectionStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { resetStores } from "@/test/fixtures";

describe("selectionStore.exitContainer + embed element picker", () => {
  beforeEach(() => resetStores());

  it("exitContainer stops picking mode first, before any other back-out step, and reports handled", () => {
    useEmbedPickerStore.getState().startPicking("e1");
    useSelectionStore.setState({ activeEmbedId: "e1", editingNodeId: "e1" });

    const handled = useSelectionStore.getState().exitContainer();

    expect(handled).toBe(true);
    expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
    // Picking-mode exit takes priority: nothing else was touched this call.
    expect(useSelectionStore.getState().activeEmbedId).toBe("e1");
    expect(useSelectionStore.getState().editingNodeId).toBe("e1");
  });

  it("stopPicking keeps a prior selection alive", () => {
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().selectElement({
      embedId: "e1",
      path: "div:nth-of-type(1)",
      tagName: "div",
      classes: [],
      textPreview: "hi",
      outerHtml: "<div>hi</div>",
    });

    useSelectionStore.getState().exitContainer();

    expect(useEmbedPickerStore.getState().selection?.embedId).toBe("e1");
  });

  it("falls through to the ordinary back-out chain when not picking", () => {
    useSelectionStore.setState({ activeEmbedId: "e1" });
    const handled = useSelectionStore.getState().exitContainer();
    expect(handled).toBe(true);
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();
  });
});
