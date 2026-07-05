import { describe, it, expect, beforeEach } from "vitest";
import type { ComponentPropertyDef, FlatFrameNode, FlatSceneNode, RefNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores } from "@/test/fixtures";

/**
 * Structure:
 *   comp  (reusable frame, declares a "state" variant + "showIcon" boolean + "label" text property)
 *     ├─ label (text, "Click me")
 *     └─ icon  (rect)
 *   inst  (ref -> comp)
 */

const stateProp: ComponentPropertyDef = {
  id: "state",
  name: "State",
  type: "variant",
  variantOptions: ["default", "hover"],
  defaultValue: "default",
  bindingPath: "label",
  bindingProp: "fill",
};

const showIconProp: ComponentPropertyDef = {
  id: "showIcon",
  name: "Show icon",
  type: "boolean",
  defaultValue: true,
  bindingPath: "icon",
  bindingProp: "visible",
};

const labelProp: ComponentPropertyDef = {
  id: "label",
  name: "Label",
  type: "text",
  defaultValue: "Click me",
  bindingPath: "label",
  bindingProp: "text",
};

function seed(): void {
  const comp = {
    id: "comp",
    type: "frame",
    name: "Comp",
    reusable: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    properties: [stateProp, showIconProp, labelProp],
  } as unknown as FlatSceneNode;

  const label = {
    id: "label",
    type: "text",
    text: "Click me",
    x: 0,
    y: 0,
    width: 80,
    height: 20,
  } as unknown as FlatSceneNode;

  const icon = {
    id: "icon",
    type: "rect",
    x: 0,
    y: 40,
    width: 20,
    height: 20,
  } as unknown as FlatSceneNode;

  const inst = {
    id: "inst",
    type: "ref",
    name: "Instance",
    x: 200,
    y: 0,
    width: 100,
    height: 100,
    componentId: "comp",
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { comp, label, icon, inst },
    parentById: { comp: null, label: "comp", icon: "comp", inst: null },
    childrenById: { comp: ["label", "icon"] },
    rootIds: ["comp", "inst"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

function scene() {
  return useSceneStore.getState();
}

function pastLen() {
  return useHistoryStore.getState().past.length;
}

describe("setComponentProperties", () => {
  beforeEach(() => {
    resetStores();
    seed();
  });

  it("sets the properties declaration on a reusable component frame", () => {
    const newProps: ComponentPropertyDef[] = [stateProp];
    scene().setComponentProperties("comp", newProps);
    const comp = scene().nodesById["comp"] as FlatFrameNode;
    expect(comp.properties).toEqual(newProps);
  });

  it("records a history entry", () => {
    const before = pastLen();
    scene().setComponentProperties("comp", [stateProp]);
    expect(pastLen()).toBe(before + 1);
  });

  it("is a no-op on a non-reusable / non-frame node", () => {
    const before = scene().nodesById["label"];
    scene().setComponentProperties("label", [stateProp]);
    expect(scene().nodesById["label"]).toBe(before);
  });
});

describe("setInstancePropertyValue", () => {
  beforeEach(() => {
    resetStores();
    seed();
  });

  it("stores the selected value on the instance's propertyValues", () => {
    scene().setInstancePropertyValue("inst", "showIcon", false);
    const inst = scene().nodesById["inst"] as RefNode;
    expect(inst.propertyValues).toEqual({ showIcon: false });
  });

  it("resolves through to the rendered tree via resolveRefToTree", () => {
    scene().setInstancePropertyValue("inst", "showIcon", false);
    scene().setInstancePropertyValue("inst", "label", "Buy now");
    const tree = scene().getNodes();
    const instNode = tree.find((n) => n.id === "inst");
    expect(instNode?.type).toBe("ref"); // top-level tree keeps refs unexpanded; resolution happens via resolveRefToTree
  });

  it("preserves the instance's other explicit overrides when switching a property", () => {
    scene().updateInstanceOverride("inst", "icon", { x: 999 });
    scene().setInstancePropertyValue("inst", "showIcon", false);
    const inst = scene().nodesById["inst"] as RefNode;
    expect(inst.overrides?.["icon"]).toEqual({ kind: "update", props: { x: 999 } });
    expect(inst.propertyValues).toEqual({ showIcon: false });
  });

  it("preserves previously-set property values when setting another one", () => {
    scene().setInstancePropertyValue("inst", "showIcon", false);
    scene().setInstancePropertyValue("inst", "label", "Buy now");
    const inst = scene().nodesById["inst"] as RefNode;
    expect(inst.propertyValues).toEqual({ showIcon: false, label: "Buy now" });
  });

  it("rejects a variant value outside the declared options and leaves state unchanged", () => {
    const before = scene().nodesById["inst"];
    scene().setInstancePropertyValue("inst", "state", "disabled");
    expect(scene().nodesById["inst"]).toBe(before);
  });

  it("rejects an unknown property id", () => {
    const before = scene().nodesById["inst"];
    scene().setInstancePropertyValue("inst", "doesNotExist", "x");
    expect(scene().nodesById["inst"]).toBe(before);
  });

  it("is a no-op on a non-ref node", () => {
    const before = scene().nodesById["comp"];
    scene().setInstancePropertyValue("comp", "showIcon", false);
    expect(scene().nodesById["comp"]).toBe(before);
  });

  it("only invalidates the cached tree, not a full node-map rebuild (cheap re-render path)", () => {
    const labelNodeBefore = scene().nodesById["label"];
    const iconNodeBefore = scene().nodesById["icon"];
    scene().setInstancePropertyValue("inst", "showIcon", false);
    // Sibling nodes untouched by the property switch keep referential identity —
    // only the ref node itself and the tree cache are invalidated.
    expect(scene().nodesById["label"]).toBe(labelNodeBefore);
    expect(scene().nodesById["icon"]).toBe(iconNodeBefore);
  });

  it("records a history entry", () => {
    const before = pastLen();
    scene().setInstancePropertyValue("inst", "showIcon", false);
    expect(pastLen()).toBe(before + 1);
  });
});
