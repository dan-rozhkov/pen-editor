import { describe, expect, it } from "vitest";
import { selectAllInScope } from "../keyboardShortcutUtils";
import type { SceneNode } from "@/types/scene";

function frame(id: string, children: SceneNode[] = []): SceneNode {
  return { id, type: "frame", x: 0, y: 0, width: 10, height: 10, children } as unknown as SceneNode;
}

function rect(id: string, visible = true): SceneNode {
  return { id, type: "rectangle", x: 0, y: 0, width: 5, height: 5, visible } as unknown as SceneNode;
}

describe("selectAllInScope", () => {
  it("selects every visible top-level node when nothing is entered", () => {
    const nodes = [rect("a"), rect("b", false), frame("c")];
    expect(selectAllInScope(nodes, { enteredContainerId: null })).toEqual(["a", "c"]);
  });

  it("selects the entered container's visible children", () => {
    const container = frame("F", [rect("x"), rect("y", false), rect("z")]);
    const nodes = [container, rect("outside")];
    expect(selectAllInScope(nodes, { enteredContainerId: "F" })).toEqual(["x", "z"]);
  });

  it("returns null (no-op) when the entered container id is stale", () => {
    // Container was deleted/undone but enteredContainerId still points at it.
    // Old behavior was to leave the selection untouched — must NOT fall back
    // to selecting every root node and silently escaping the scope.
    const nodes = [rect("a"), rect("b")];
    expect(selectAllInScope(nodes, { enteredContainerId: "gone" })).toBeNull();
  });

  it("returns null when the entered id resolves to a non-container node", () => {
    const nodes = [rect("a"), rect("b")];
    expect(selectAllInScope(nodes, { enteredContainerId: "a" })).toBeNull();
  });
});
