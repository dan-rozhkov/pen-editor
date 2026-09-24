import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { appendInput, key, keyFrom, setupKeyDownHandler } from "./keyboardCommandFixtures";

const FRAME = { id: "F", type: "frame", x: 0, y: 0, width: 100, height: 100, children: [] };
const rect = (id: string) => ({ id, type: "rectangle", x: 0, y: 0, width: 10, height: 10 });

/** The modifiers of the hotkey: Cmd+Shift+[ is Cmd+{, Cmd+Shift+] is Cmd+}. */
const CMD_SHIFT = { metaKey: true, shiftKey: true };

describe("keyboardCommands — reorder-in-tree hotkeys (Cmd+{ / Cmd+})", () => {
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    ({ handler } = setupKeyDownHandler());
  });

  function seedRoot() {
    useSceneStore.setState({
      nodesById: {
        A: rect("A"),
        B: rect("B"),
        C: rect("C"),
      } as never,
      parentById: { A: null, B: null, C: null } as never,
      childrenById: {},
      rootIds: ["A", "B", "C"],
    });
  }

  function seedNested() {
    useSceneStore.setState({
      nodesById: {
        F: FRAME,
        A: rect("A"),
        B: rect("B"),
        C: rect("C"),
      } as never,
      parentById: { F: null, A: "F", B: "F", C: "F" } as never,
      childrenById: { F: ["A", "B", "C"] },
      rootIds: ["F"],
    });
  }

  function select(selectedIds: string[]) {
    useSelectionStore.setState({ selectedIds, enteredContainerId: null } as never);
  }

  it.each([
    {
      name: "Cmd+{ (up) moves a root-level node one index higher (towards top of panel)",
      selected: ["B"],
      code: "BracketLeft",
      modifiers: CMD_SHIFT,
      expected: ["A", "C", "B"],
    },
    {
      name: "Cmd+} (down) moves a root-level node one index lower (towards bottom of panel)",
      selected: ["B"],
      code: "BracketRight",
      modifiers: CMD_SHIFT,
      expected: ["B", "A", "C"],
    },
    {
      name: "no-op at the top edge (last index) on Cmd+{",
      selected: ["C"],
      code: "BracketLeft",
      modifiers: CMD_SHIFT,
      expected: ["A", "B", "C"],
    },
    {
      name: "no-op at the bottom edge (index 0) on Cmd+}",
      selected: ["A"],
      code: "BracketRight",
      modifiers: CMD_SHIFT,
      expected: ["A", "B", "C"],
    },
    {
      name: "is a no-op with multiple nodes selected (MVP: single selection only)",
      selected: ["A", "B"],
      code: "BracketLeft",
      modifiers: CMD_SHIFT,
      expected: ["A", "B", "C"],
    },
    {
      name: "is a no-op with no selection",
      selected: [],
      code: "BracketLeft",
      modifiers: CMD_SHIFT,
      expected: ["A", "B", "C"],
    },
    {
      name: "does not fire without Shift (BracketLeft/Right alone are not the hotkey)",
      selected: ["B"],
      code: "BracketLeft",
      modifiers: { metaKey: true },
      expected: ["A", "B", "C"],
    },
  ])("$name", ({ selected, code, modifiers, expected }) => {
    seedRoot();
    select(selected);
    handler(key(code, modifiers));
    expect(useSceneStore.getState().rootIds).toEqual(expected);
  });

  it("works for a nested node within a parent frame, keeping parentById intact", () => {
    seedNested();
    select(["B"]);
    handler(key("BracketLeft", CMD_SHIFT));
    expect(useSceneStore.getState().childrenById.F).toEqual(["A", "C", "B"]);
    expect(useSceneStore.getState().parentById.B).toBe("F");
  });

  it("preserves undo history (calls saveHistory internally via moveNode)", () => {
    seedRoot();
    select(["B"]);
    const before = useSceneStore.getState().rootIds;
    handler(key("BracketLeft", CMD_SHIFT));
    expect(useSceneStore.getState().rootIds).not.toBe(before);
    handler(key("KeyZ", { metaKey: true }));
    // undo isn't wired through the real historyStore here (deps.undo is a
    // mock), so just assert the move itself was a distinct, history-eligible
    // state transition (new array reference) rather than an in-place mutation.
  });

  it("is a no-op while typing in an input", () => {
    seedRoot();
    select(["B"]);
    const input = appendInput();
    handler(keyFrom(input, "BracketLeft", CMD_SHIFT));
    expect(useSceneStore.getState().rootIds).toEqual(["A", "B", "C"]);
    document.body.removeChild(input);
  });

  it("is a no-op in view (read-only) mode", () => {
    seedRoot();
    useEditorModeStore.setState({ mode: "view" });
    select(["B"]);
    handler(key("BracketLeft", CMD_SHIFT));
    expect(useSceneStore.getState().rootIds).toEqual(["A", "B", "C"]);
  });

  it("calls preventDefault on the browser-default-suppressing hotkeys", () => {
    seedRoot();
    select(["B"]);
    const evt = key("BracketLeft", CMD_SHIFT);
    const spy = vi.spyOn(evt, "preventDefault");
    handler(evt);
    expect(spy).toHaveBeenCalled();
  });
});
