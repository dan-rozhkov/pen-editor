import { describe, it, expect, beforeEach } from "vitest";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores } from "@/test/fixtures";

describe("selectionStore activeEmbedId", () => {
  beforeEach(() => resetStores());

  it("defaults to null", () => {
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();
  });

  it("setActiveEmbed sets and clears the active embed", () => {
    useSelectionStore.getState().setActiveEmbed("embed1");
    expect(useSelectionStore.getState().activeEmbedId).toBe("embed1");
    useSelectionStore.getState().setActiveEmbed(null);
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();
  });

  it("clears activeEmbedId when selection changes", () => {
    useSelectionStore.getState().setActiveEmbed("embed1");
    useSelectionStore.getState().select("rect1");
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();
  });

  it("clears activeEmbedId on clearSelection", () => {
    useSelectionStore.getState().setActiveEmbed("embed1");
    useSelectionStore.getState().clearSelection();
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();
  });

  it("clears activeEmbedId on addToSelection / removeFromSelection", () => {
    useSelectionStore.getState().setActiveEmbed("embed1");
    useSelectionStore.getState().addToSelection("rect1");
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();

    useSelectionStore.getState().setActiveEmbed("embed1");
    useSelectionStore.getState().removeFromSelection("rect1");
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();
  });

  it("clears activeEmbedId on selectRange", () => {
    useSelectionStore.getState().setActiveEmbed("embed1");
    useSelectionStore.getState().selectRange("a", "c", ["a", "b", "c"]);
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();
  });

  it("clears activeEmbedId on stopEditing and exitContainer", () => {
    useSelectionStore.getState().setActiveEmbed("embed1");
    useSelectionStore.getState().stopEditing();
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();

    useSelectionStore.getState().setActiveEmbed("embed1");
    useSelectionStore.getState().exitContainer();
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();
  });
});
