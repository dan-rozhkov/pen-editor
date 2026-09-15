import { describe, it, expect, beforeEach } from "vitest";
import { useSelectionStore } from "@/store/selectionStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { resetStores } from "@/test/fixtures";

describe("selectionStore.exitContainer + embed element picker", () => {
  beforeEach(() => resetStores());

  it("exitContainer clears a picked element first, before any other back-out step, and reports handled", () => {
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().selectElement({
      embedId: "e1",
      path: "div:nth-of-type(1)",
      tagName: "div",
      classes: [],
      textPreview: "hi",
      outerHtml: "<div>hi</div>",
    });
    useSelectionStore.setState({ activeEmbedId: "e1", editingNodeId: "e1" });

    const handled = useSelectionStore.getState().exitContainer();

    expect(handled).toBe(true);
    expect(useEmbedPickerStore.getState().selection).toBeNull();
    // Clearing the picked element takes priority: nothing else was touched
    // this call — picking itself is left alone too (auto-start owns it, not
    // Escape), and the surrounding activeEmbedId/editingNodeId are untouched.
    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");
    expect(useSelectionStore.getState().activeEmbedId).toBe("e1");
    expect(useSelectionStore.getState().editingNodeId).toBe("e1");
  });

  it("falls through to the ordinary back-out chain when no element is picked, even while picking mode is active", () => {
    // Picking with no element selected yet (e.g. auto-started on selection,
    // nothing clicked inside the embed) — Escape must not treat this as
    // "handled" by the picker; it should fall through to the ordinary chain.
    useEmbedPickerStore.getState().startPicking("e1");
    useSelectionStore.setState({ activeEmbedId: "e1" });

    const handled = useSelectionStore.getState().exitContainer();

    expect(handled).toBe(true);
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();
    // Picking mode itself is left running — only the lifecycle hook (reacting
    // to a selection change) turns it off, not exitContainer directly.
    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");
  });

  it("falls through to the ordinary back-out chain when not picking at all", () => {
    useSelectionStore.setState({ activeEmbedId: "e1" });
    const handled = useSelectionStore.getState().exitContainer();
    expect(handled).toBe(true);
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();
  });
});
