import { useHistoryStore } from "@/store/historyStore";
import { createSnapshot } from "@/store/sceneStore";
import { assertDefined } from "@/test/assertions";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetStores } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { makeThemeCollection } from "@/lib/variables/collections";
import type { Variable, VariableCollection } from "@/types/variable";
import { consumeDirty } from "@/store/sceneStore/dirtyTracking";
import { flushNumberBindings, startNumberBindingSync } from "@/store/numberBindingSync";
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
/** Subscriber-triggered passes run in a coalesced microtask; await it. */
const flush = () => Promise.resolve();

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
  it("materializes bindings on start and when a variable value changes", async () => {
    seed([bound("a"), bound("b"), frame("plain", { cornerRadius: 7 })]);
    stop = startNumberBindingSync();
    expect(n("a")).toMatchObject({ cornerRadius: 12, layout: { gap: 16 } });
    useVariableStore.getState().setVariableModeValue("r", "light", "20");
    await flush();
    useVariableStore.getState().setVariableModeValue("r", "dark", "20");
    await flush();
    expect(n("a").cornerRadius).toBe(20);
    expect(n("b").cornerRadius).toBe(20);
    expect(n("plain").cornerRadius).toBe(7);
  });

  it("re-materializes when the active mode changes", async () => {
    seed([bound("a")]);
    stop = startNumberBindingSync();
    expect((n("a").layout as { gap: number }).gap).toBe(16);
    useThemeStore.getState().setActiveTheme("dark");
    await flush();
    expect((n("a").layout as { gap: number }).gap).toBe(24);
  });

  it("follows a frame themeOverride on an ancestor", async () => {
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
    await flush();
    expect((n("c").layout as { gap: number }).gap).toBe(24);
  });

  it("binds a node that becomes bound later (incremental discovery)", async () => {
    seed([frame("a", { cornerRadius: 1 })]);
    stop = startNumberBindingSync();
    scene().updateNode("a", { numberBindings: { cornerRadius: { variableId: "r" } } } as never);
    await flush();
    expect(n("a").cornerRadius).toBe(12);
  });

  it("a manual edit survives later variable changes (unbound for good)", async () => {
    seed([bound("a")]);
    stop = startNumberBindingSync();
    scene().updateNode("a", { cornerRadius: 3 });
    useVariableStore.getState().setVariableModeValue("r", "light", "99");
    await flush();
    expect(n("a").cornerRadius).toBe(3);
  });

  it("writes nothing when nothing changed (no subscribe loop)", async () => {
    seed([bound("a")]);
    stop = startNumberBindingSync();
    let writes = 0;
    const unsub = useSceneStore.subscribe(() => writes++);
    useThemeStore.getState().setActiveTheme("light"); // same value: store skips notify
    await flush();
    useVariableStore.getState().setVariables(useVariableStore.getState().variables); // same values
    await flush();
    unsub();
    expect(writes).toBe(0);
  });

  it("marks patched ids dirty inside the same update (no full-scan poisoning)", async () => {
    seed([bound("a"), frame("x")]);
    stop = startNumberBindingSync();
    consumeDirty();
    useVariableStore.getState().setVariableModeValue("r", "light", "50");
    await flush();
    useVariableStore.getState().setVariableModeValue("r", "dark", "50");
    await flush();
    const dirty = consumeDirty();
    expect(dirty.ids.has("a")).toBe(true);
    expect(dirty.ids.has("x")).toBe(false);
  });

  it("undo of a variable edit restores the variable and the materialized literals together", async () => {
    seed([bound("a")]);
    stop = startNumberBindingSync();
    useVariableStore.getState().updateVariable("r", { value: "33" });
    await flush();
    expect(n("a").cornerRadius).toBe(33);
    const prev = useHistoryStore.getState().undo(createSnapshot(useSceneStore.getState()));
    assertDefined(prev);
    useSceneStore.getState().restoreSnapshot(prev);
    await flush();
    expect(useVariableStore.getState().variables.find((v) => v.id === "r")?.value).toBe("12");
    expect(n("a").cornerRadius).toBe(12);
  });

  it("5k bound nodes: one variable edit is ONE batched scene write", async () => {
    const nodes: FlatSceneNode[] = [];
    for (let i = 0; i < 5000; i++) nodes.push(bound(`n${i}`));
    seed(nodes);
    stop = startNumberBindingSync();
    let writes = 0;
    const unsub = useSceneStore.subscribe(() => writes++);
    useVariableStore.getState().updateVariable("r", { value: "33" });
    await flush();
    unsub();
    expect(writes).toBe(1);
    expect(n("n0").cornerRadius).toBe(33);
    expect(n("n4999").cornerRadius).toBe(33);
  });
});

describe("numberBindingSync: non-Theme collection modes (Brand)", () => {
  const brand: VariableCollection = {
    id: "brand",
    name: "Brand",
    modes: [
      { id: "soft", name: "Soft" },
      { id: "sharp", name: "Sharp" },
    ],
    defaultModeId: "soft",
  };
  const cornerVar: Variable = {
    id: "br",
    name: "--brand-radius",
    type: "number",
    collectionId: "brand",
    valuesByMode: { soft: "16", sharp: "2" },
    value: "16",
  };
  const radiusBound = (id: string) =>
    frame(id, { cornerRadius: 1, numberBindings: { cornerRadius: { variableId: "br" } } });

  beforeEach(() => {
    useVariableStore.getState().replaceAll([cornerVar], [makeThemeCollection(), brand]);
    consumeDirty();
  });

  it("starts in the default Brand mode", async () => {
    seed([radiusBound("a")]);
    stop = startNumberBindingSync();
    expect(n("a").cornerRadius).toBe(16);
  });

  it("re-materializes when the document modeContext switches Brand mode", async () => {
    seed([radiusBound("a"), frame("plain", { cornerRadius: 7 })]);
    stop = startNumberBindingSync();
    useThemeStore.getState().setCollectionMode("brand", "sharp");
    await flush();
    expect(n("a").cornerRadius).toBe(2);
    expect(n("plain").cornerRadius).toBe(7);
    useThemeStore.getState().setModeContext({ theme: "light" });
    await flush();
    expect(n("a").cornerRadius).toBe(16);
  });

  it("re-materializes descendants when a frame's modeOverrides switch Brand mode", async () => {
    const f = frame("f");
    const c = radiusBound("c");
    const other = radiusBound("o");
    useSceneStore.setState({
      nodesById: { f, c, o: other },
      parentById: { f: null, c: "f", o: null },
      childrenById: { f: ["c"] },
      rootIds: ["f", "o"],
      _cachedTree: null,
    });
    stop = startNumberBindingSync();
    expect(n("c").cornerRadius).toBe(16);
    scene().updateNode("f", { modeOverrides: { brand: "sharp" } } as never);
    await flush();
    expect(n("c").cornerRadius).toBe(2);
    expect(n("o").cornerRadius).toBe(16); // not a descendant
    scene().updateNode("f", { modeOverrides: undefined } as never);
    await flush();
    expect(n("c").cornerRadius).toBe(16);
  });

  it("an override wins over the document context, and a nested override over its parent's", async () => {
    const f = frame("f", { modeOverrides: { brand: "sharp" } });
    const g = frame("g", { modeOverrides: { brand: "soft" } });
    const c = radiusBound("c");
    useSceneStore.setState({
      nodesById: { f, g, c },
      parentById: { f: null, g: "f", c: "g" },
      childrenById: { f: ["g"], g: ["c"] },
      rootIds: ["f"],
      _cachedTree: null,
    });
    useThemeStore.getState().setCollectionMode("brand", "sharp");
    await flush();
    stop = startNumberBindingSync();
    expect(n("c").cornerRadius).toBe(16); // g (soft) beats f (sharp) beats doc
  });

  it("a legacy themeOverride change on a frame is still picked up", async () => {
    const f = frame("f");
    const c = frame("c", {
      cornerRadius: 1,
      numberBindings: { cornerRadius: { variableId: "r" } },
    });
    useVariableStore.getState().replaceAll(
      [
        ...useVariableStore.getState().variables,
        { id: "r", name: "--r", type: "number", collectionId: "theme", valuesByMode: { light: "4", dark: "8" }, value: "4" },
      ],
      [makeThemeCollection(), brand],
    );
    useSceneStore.setState({
      nodesById: { f, c },
      parentById: { f: null, c: "f" },
      childrenById: { f: ["c"] },
      rootIds: ["f"],
      _cachedTree: null,
    });
    stop = startNumberBindingSync();
    expect(n("c").cornerRadius).toBe(4);
    scene().updateNode("f", { themeOverride: "dark" } as never);
    await flush();
    expect(n("c").cornerRadius).toBe(8);
  });

  it("writes nothing when the new mode context resolves to the same numbers (no loop)", async () => {
    seed([radiusBound("a")]);
    stop = startNumberBindingSync();
    const before = scene().nodesById;
    useThemeStore.getState().setCollectionMode("theme", "dark"); // Brand var is unaffected
    await flush();
    expect(scene().nodesById).toBe(before);
  });
});

describe("numberBindingSync: reparenting and deferral", () => {
  const sized = (id: string) => frame(id, { cornerRadius: 1, numberBindings: { cornerRadius: { variableId: "sp" } } });

  function seedTree() {
    const dark = frame("dark", { modeOverrides: { theme: "dark" } });
    const light = frame("light");
    const c = sized("c");
    const kid = frame("kid");
    const deep = sized("deep");
    useSceneStore.setState({
      nodesById: { dark, light, c, kid, deep },
      parentById: { dark: null, light: null, c: "light", kid: "light", deep: "kid" },
      childrenById: { dark: [], light: ["c", "kid"], kid: ["deep"] },
      rootIds: ["dark", "light"],
      _cachedTree: null,
    });
  }

  it("moveNode of a bound node under a frame with other modeOverrides re-materializes it", async () => {
    seedTree();
    stop = startNumberBindingSync();
    expect(n("c").cornerRadius).toBe(16);
    scene().moveNode("c", "dark", 0);
    await flush();
    expect(n("c").cornerRadius).toBe(24);
    scene().moveNode("c", "light", 0);
    await flush();
    expect(n("c").cornerRadius).toBe(16);
  });

  it("moving a frame re-materializes its bound descendants, and nothing else", async () => {
    seedTree();
    stop = startNumberBindingSync();
    const before = n("c");
    scene().moveNode("kid", "dark", 0);
    await flush();
    expect(n("deep").cornerRadius).toBe(24);
    expect(n("c")).toBe(before);
  });

  it("defers the patch: it is not applied inside the notifying update, and triggers coalesce", async () => {
    seed([bound("a"), bound("b")]);
    stop = startNumberBindingSync();
    const radiusSeenBySubscriber: unknown[] = [];
    const unsub = useVariableStore.subscribe(() => radiusSeenBySubscriber.push(n("a").cornerRadius));
    let sceneWrites = 0;
    const unsubScene = useSceneStore.subscribe(() => sceneWrites++);
    useVariableStore.getState().setVariableModeValue("r", "light", "30");
    useVariableStore.getState().setVariableModeValue("r", "dark", "30");
    useThemeStore.getState().setActiveTheme("dark");
    expect(sceneWrites).toBe(0); // nothing nested in the subscribers
    expect(n("a").cornerRadius).toBe(12);
    await flush();
    unsub();
    unsubScene();
    expect(sceneWrites).toBe(1); // three triggers, one pass
    expect(n("a").cornerRadius).toBe(30);
    expect(radiusSeenBySubscriber.every((v) => v === 12)).toBe(true);
  });

  it("a stopped sync drops its pending pass", async () => {
    seed([bound("a")]);
    stop = startNumberBindingSync();
    useVariableStore.getState().updateVariable("r", { value: "77" });
    stop();
    await flush();
    expect(n("a").cornerRadius).toBe(12);
  });
});

describe("flushNumberBindings", () => {
  it("applies a pending subscriber pass synchronously, and is a no-op when idle", async () => {
    seed([bound("a")]);
    stop = startNumberBindingSync();
    expect(n("a").cornerRadius).toBe(12);
    useVariableStore.getState().setVariables([
      { id: "r", name: "--radius", type: "number", value: "20" },
      { id: "sp", name: "--space", type: "number", value: "16", themeValues: { light: "16", dark: "24" } },
    ]);
    expect(n("a").cornerRadius).toBe(12); // microtask not run yet
    flushNumberBindings();
    expect(n("a").cornerRadius).toBe(20); // same task
    flushNumberBindings();
    await flush();
    expect(n("a").cornerRadius).toBe(20);
  });

  it("is a no-op once the sync is stopped", () => {
    seed([bound("a")]);
    stop = startNumberBindingSync();
    stop();
    expect(() => flushNumberBindings()).not.toThrow();
  });
});

describe("mode scope: a node that stops being a frame", () => {
  const brand: VariableCollection = {
    id: "brand",
    name: "Brand",
    modes: [
      { id: "soft", name: "soft" },
      { id: "sharp", name: "sharp" },
    ],
    defaultModeId: "soft",
  };
  const cornerVar: Variable = {
    id: "br",
    name: "--brand-radius",
    type: "number",
    collectionId: "brand",
    valuesByMode: { soft: "16", sharp: "2" },
    value: "16",
  };

  it("re-materializes descendants when a frame with overrides becomes a rect", async () => {
    useVariableStore.getState().replaceAll([cornerVar], [makeThemeCollection(), brand]);
    consumeDirty();
    const f = frame("f", { modeOverrides: { brand: "sharp" } });
    const c = frame("c", { cornerRadius: 1, numberBindings: { cornerRadius: { variableId: "br" } } });
    useSceneStore.setState({
      nodesById: { f, c },
      parentById: { f: null, c: "f" },
      childrenById: { f: ["c"] },
      rootIds: ["f"],
      _cachedTree: null,
    });
    stop = startNumberBindingSync();
    expect(n("c").cornerRadius).toBe(2);
    scene().updateNode("f", { type: "rect" } as never);
    await flush();
    expect(n("c").cornerRadius).toBe(16);
  });
});
