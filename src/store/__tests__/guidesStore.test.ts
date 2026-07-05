import { beforeEach, describe, expect, it } from "vitest";
import { useGuidesStore } from "@/store/guidesStore";

describe("guidesStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useGuidesStore.setState({ guides: [], showRulers: false });
  });

  it("starts with no guides and rulers hidden by default", () => {
    const state = useGuidesStore.getState();
    expect(state.guides).toEqual([]);
    expect(state.showRulers).toBe(false);
  });

  it("toggleShowRulers flips the flag and persists it", () => {
    useGuidesStore.getState().toggleShowRulers();
    expect(useGuidesStore.getState().showRulers).toBe(true);
    expect(localStorage.getItem("show-rulers")).toBe("true");

    useGuidesStore.getState().toggleShowRulers();
    expect(useGuidesStore.getState().showRulers).toBe(false);
    expect(localStorage.getItem("show-rulers")).toBe("false");
  });

  it("setShowRulers sets an explicit value", () => {
    useGuidesStore.getState().setShowRulers(true);
    expect(useGuidesStore.getState().showRulers).toBe(true);
  });

  it("addGuide appends a guide with a unique id and returns it", () => {
    const id1 = useGuidesStore.getState().addGuide("vertical", 100);
    const id2 = useGuidesStore.getState().addGuide("horizontal", 50);

    const { guides } = useGuidesStore.getState();
    expect(guides).toHaveLength(2);
    expect(guides[0]).toEqual({ id: id1, orientation: "vertical", position: 100 });
    expect(guides[1]).toEqual({ id: id2, orientation: "horizontal", position: 50 });
    expect(id1).not.toBe(id2);
  });

  it("removeGuide deletes only the targeted guide", () => {
    const id1 = useGuidesStore.getState().addGuide("vertical", 100);
    const id2 = useGuidesStore.getState().addGuide("horizontal", 50);

    useGuidesStore.getState().removeGuide(id1);

    const { guides } = useGuidesStore.getState();
    expect(guides).toHaveLength(1);
    expect(guides[0].id).toBe(id2);
  });

  it("updateGuidePosition moves the targeted guide without affecting others", () => {
    const id1 = useGuidesStore.getState().addGuide("vertical", 100);
    const id2 = useGuidesStore.getState().addGuide("horizontal", 50);

    useGuidesStore.getState().updateGuidePosition(id1, 250);

    const { guides } = useGuidesStore.getState();
    expect(guides.find((g) => g.id === id1)?.position).toBe(250);
    expect(guides.find((g) => g.id === id2)?.position).toBe(50);
  });

  it("setGuides replaces the whole list (page switch/load)", () => {
    useGuidesStore.getState().addGuide("vertical", 100);
    useGuidesStore.getState().setGuides([
      { id: "g1", orientation: "horizontal", position: 10 },
    ]);

    const { guides } = useGuidesStore.getState();
    expect(guides).toEqual([{ id: "g1", orientation: "horizontal", position: 10 }]);
  });

  it("clearGuides empties the list", () => {
    useGuidesStore.getState().addGuide("vertical", 100);
    useGuidesStore.getState().clearGuides();
    expect(useGuidesStore.getState().guides).toEqual([]);
  });
});
