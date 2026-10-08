import { useHistoryStore } from "@/store/historyStore";
import { createSnapshot } from "@/store/sceneStore";
import { assertDefined } from "@/test/assertions";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetStores } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { consumeDirty } from "@/store/sceneStore/dirtyTracking";
import { startNumberBindingSync } from "@/store/numberBindingSync";
import type { FlatSceneNode } from "@/types/scene";

const scene = () => useSceneStore.getState();
const n = (id: string) => scene().nodesById[id] as unknown as Record<string, unknown>;

function frame(id: string, extra: Record<string, unknown> = {}): FlatSceneNode {
  return { id, type: "frame", x: 0, y: 0, width: 100, height: 100, ...extra } as unknown as FlatSceneNode;
}

function seed(nodes: FlatSceneNode[]) {
  const nodesById: Record<string, FlatSceneNode> = {};
  const parentById: Record<string, string | null> = {};
  for (const node of nodes) {
    nodesById[node.id] = node;
    parentById[node.id] = null;
  }
  useSceneStore.setState({ nodesById, parentById, childrenById: {}, rootIds: nodes.map((x) => x.id), _cachedTree: null });
}

let stop: () => void;

beforeEach(() => {
  resetStores();
  useVariableStore.getState().setVariables([
    { id: "r", name: "--radius", type: "number", value: "12" },
    { id: "sp", name: "--space", type: "number", value: "16", themeValues: { light: "16", dark: "24" } },
  ]);
  consumeDirty();
});

afterEach(() => stop?.());

const bound = (id: string, extra: Record<string, unknown> = {}) =>
  frame(id, {
    cornerRadius: 1,
    layout: { autoLayout: true, gap: 1 },
    numberBindings: { cornerRadius: { variableId: "r" }, gap: { variableId: "sp" } },
    ...extra,
  });

describe("unbind-on-literal-write (sceneStore)", () => {
  beforeEach(() => {
    seed([frame("a", { cornerRadius: 12, layout: { autoLayout: true, gap: 16, paddingTop: 16 }, numberBindings: { cornerRadius: { variableId: "r" }, gap: { variableId: "sp" }, paddingTop: { variableId: "sp" } } })]);
  });

  it("updateNode with a different value drops that binding only", () => {
    scene().updateNode("a", { cornerRadius: 3 });
    expect(n("a").cornerRadius).toBe(3);
    expect(n("a").numberBindings).toEqual({ gap: { variableId: "sp" }, paddingTop: { variableId: "sp" } });
  });

  it("a nested layout write drops the layout key binding", () => {
    scene().updateNode("a", { layout: { autoLayout: true, gap: 4, paddingTop: 16 } } as never);
    expect(n("a").numberBindings).toEqual({ cornerRadius: { variableId: "r" }, paddingTop: { variableId: "sp" } });
  });

  it("every other update path unbinds too", () => {
    scene().updateNodeWithoutHistory("a", { cornerRadius: 2 });
    expect((n("a").numberBindings as Record<string, unknown>).cornerRadius).toBeUndefined();
    scene().updateNodesById({ a: { layout: { autoLayout: true, gap: 9, paddingTop: 16 } } as never });
    expect((n("a").numberBindings as Record<string, unknown>).gap).toBeUndefined();
    scene().updateMultipleNodesMerged(["a"], { layout: { paddingTop: 1 } } as never, ["layout"]);
    expect(n("a").numberBindings).toBeUndefined();
  });

  it("writing the current literal back keeps the binding", () => {
    scene().updateNode("a", { cornerRadius: 12 });
    expect(n("a").numberBindings).toBeDefined();
    expect((n("a").numberBindings as Record<string, unknown>).cornerRadius).toBeDefined();
  });

  it("scaleNodes unbinds scaled fields", () => {
    scene().scaleNodes(["a"], 2);
    expect(n("a").cornerRadius).toBe(24);
    expect(n("a").numberBindings).toBeUndefined();
  });

  it("an explicit numberBindings write is respected", () => {
    scene().updateNode("a", { cornerRadius: 5, numberBindings: { cornerRadius: { variableId: "r" } } } as never);
    expect(n("a").numberBindings).toEqual({ cornerRadius: { variableId: "r" } });
  });

  it("applyBoundNumberPatches keeps the bindings it realizes and writes no history", () => {
    scene().applyBoundNumberPatches({ a: { cornerRadius: 30 } });
    expect(n("a").cornerRadius).toBe(30);
    expect((n("a").numberBindings as Record<string, unknown>).cornerRadius).toBeDefined();
  });
});

describe("numberBindingSync", () => {
  it("materializes bindings on start and when a variable value changes", () => {
    seed([bound("a"), bound("b"), frame("plain", { cornerRadius: 7 })]);
    stop = startNumberBindingSync();
    expect(n("a")).toMatchObject({ cornerRadius: 12, layout: { gap: 16 } });
    useVariableStore.getState().setVariableModeValue("r", "light", "20");
    useVariableStore.getState().setVariableModeValue("r", "dark", "20");
    expect(n("a").cornerRadius).toBe(20);
    expect(n("b").cornerRadius).toBe(20);
    expect(n("plain").cornerRadius).toBe(7);
  });

  it("re-materializes when the active mode changes", () => {
    seed([bound("a")]);
    stop = startNumberBindingSync();
    expect((n("a").layout as { gap: number }).gap).toBe(16);
    useThemeStore.getState().setActiveTheme("dark");
    expect((n("a").layout as { gap: number }).gap).toBe(24);
  });

  it("follows a frame themeOverride on an ancestor", () => {
    const f = frame("f");
    const c = bound("c");
    useSceneStore.setState({
      nodesById: { f, c },
      parentById: { f: null, c: "f" },
      childrenById: { f: ["c"] },
      rootIds: ["f"],
      _cachedTree: null,
    });
    stop = startNumberBindingSync();
    expect((n("c").layout as { gap: number }).gap).toBe(16);
    scene().updateNode("f", { themeOverride: "dark" } as never);
    expect((n("c").layout as { gap: number }).gap).toBe(24);
  });

  it("binds a node that becomes bound later (incremental discovery)", () => {
    seed([frame("a", { cornerRadius: 1 })]);
    stop = startNumberBindingSync();
    scene().updateNode("a", { numberBindings: { cornerRadius: { variableId: "r" } } } as never);
    expect(n("a").cornerRadius).toBe(12);
  });

  it("a manual edit survives later variable changes (unbound for good)", () => {
    seed([bound("a")]);
    stop = startNumberBindingSync();
    scene().updateNode("a", { cornerRadius: 3 });
    useVariableStore.getState().setVariableModeValue("r", "light", "99");
    expect(n("a").cornerRadius).toBe(3);
  });

  it("writes nothing when nothing changed (no subscribe loop)", () => {
    seed([bound("a")]);
    stop = startNumberBindingSync();
    let writes = 0;
    const unsub = useSceneStore.subscribe(() => writes++);
    useThemeStore.getState().setActiveTheme("light"); // same value: store skips notify
    useVariableStore.getState().setVariables(useVariableStore.getState().variables); // same values
    unsub();
    expect(writes).toBe(0);
  });

  it("marks patched ids dirty inside the same update (no full-scan poisoning)", () => {
    seed([bound("a"), frame("x")]);
    stop = startNumberBindingSync();
    consumeDirty();
    useVariableStore.getState().setVariableModeValue("r", "light", "50");
    useVariableStore.getState().setVariableModeValue("r", "dark", "50");
    const dirty = consumeDirty();
    expect(dirty.ids.has("a")).toBe(true);
    expect(dirty.ids.has("x")).toBe(false);
  });

  it("undo of a variable edit restores the variable and the materialized literals together", () => {
    seed([bound("a")]);
    stop = startNumberBindingSync();
    useVariableStore.getState().updateVariable("r", { value: "33" });
    expect(n("a").cornerRadius).toBe(33);
    const prev = useHistoryStore.getState().undo(createSnapshot(useSceneStore.getState()));
    assertDefined(prev);
    useSceneStore.getState().restoreSnapshot(prev);
    expect(useVariableStore.getState().variables.find((v) => v.id === "r")?.value).toBe("12");
    expect(n("a").cornerRadius).toBe(12);
  });

  it("5k bound nodes: one variable edit is ONE batched scene write", () => {
    const nodes: FlatSceneNode[] = [];
    for (let i = 0; i < 5000; i++) nodes.push(bound(`n${i}`));
    seed(nodes);
    stop = startNumberBindingSync();
    let writes = 0;
    const unsub = useSceneStore.subscribe(() => writes++);
    useVariableStore.getState().updateVariable("r", { value: "33" });
    unsub();
    expect(writes).toBe(1);
    expect(n("n0").cornerRadius).toBe(33);
    expect(n("n4999").cornerRadius).toBe(33);
  });
});
