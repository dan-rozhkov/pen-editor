import { beforeEach, describe, expect, it } from "vitest";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { key, setupKeyDownHandler } from "./keyboardCommandFixtures";

function tab(opts: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return key("Tab", opts);
}

function node(id: string, visible = true) {
  return { id, type: "rectangle", x: 0, y: 0, width: 10, height: 10, visible };
}

describe("keyboardCommands — Tab navigation", () => {
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    ({ handler } = setupKeyDownHandler());
    // Three root siblings A, B, C.
    useSceneStore.setState({
      nodesById: { A: node("A"), B: node("B"), C: node("C") } as never,
      parentById: { A: null, B: null, C: null },
      childrenById: {},
      rootIds: ["A", "B", "C"],
    });
    useSelectionStore.setState({ selectedIds: ["A"], enteredContainerId: null } as never);
  });

  it("Tab selects the next sibling", () => {
    handler(tab());
    expect(useSelectionStore.getState().selectedIds).toEqual(["B"]);
  });

  it("Tab wraps around from the last sibling to the first", () => {
    useSelectionStore.setState({ selectedIds: ["C"] } as never);
    handler(tab());
    expect(useSelectionStore.getState().selectedIds).toEqual(["A"]);
  });

  it("Shift+Tab selects the previous sibling", () => {
    useSelectionStore.setState({ selectedIds: ["B"] } as never);
    handler(tab({ shiftKey: true }));
    expect(useSelectionStore.getState().selectedIds).toEqual(["A"]);
  });

  it("Shift+Tab wraps around from the first sibling to the last", () => {
    handler(tab({ shiftKey: true }));
    expect(useSelectionStore.getState().selectedIds).toEqual(["C"]);
  });

  it("Tab prevents the browser's default focus traversal", () => {
    const e = tab();
    handler(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it("Tab navigates among children of a parent, not root nodes", () => {
    useSceneStore.setState({
      nodesById: {
        F: node("F"),
        X: node("X"),
        Y: node("Y"),
      } as never,
      parentById: { F: null, X: "F", Y: "F" },
      childrenById: { F: ["X", "Y"] },
      rootIds: ["F"],
    });
    useSelectionStore.setState({ selectedIds: ["X"] } as never);
    handler(tab());
    expect(useSelectionStore.getState().selectedIds).toEqual(["Y"]);
  });

  it("Tab skips hidden siblings", () => {
    useSceneStore.setState({
      nodesById: { A: node("A"), B: node("B", false), C: node("C") } as never,
      parentById: { A: null, B: null, C: null },
      childrenById: {},
      rootIds: ["A", "B", "C"],
    });
    useSelectionStore.setState({ selectedIds: ["A"] } as never);
    handler(tab());
    expect(useSelectionStore.getState().selectedIds).toEqual(["C"]);
  });

  it("Tab is a no-op when nothing is selected", () => {
    useSelectionStore.setState({ selectedIds: [] } as never);
    const e = tab();
    handler(e);
    expect(useSelectionStore.getState().selectedIds).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
  });

  it("Tab is a no-op with a multi-node selection", () => {
    useSelectionStore.setState({ selectedIds: ["A", "B"] } as never);
    handler(tab());
    expect(useSelectionStore.getState().selectedIds).toEqual(["A", "B"]);
  });

  it("works in view mode too (selection is non-mutating)", () => {
    useEditorModeStore.setState({ mode: "view" });
    handler(tab());
    expect(useSelectionStore.getState().selectedIds).toEqual(["B"]);
  });
});
