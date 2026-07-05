import { describe, it, expect } from "vitest";
import type { ComponentPropertyDef, FlatSceneNode, RefNode } from "@/types/scene";
import { resolveRefToTree } from "@/utils/instanceRuntime";

/**
 * End-to-end coverage that a component's declared properties actually affect
 * the resolved instance tree (the shape `pixiSync`/the properties panel read),
 * and that switching a property value never clobbers the instance's other,
 * independently-set overrides.
 *
 * Structure:
 *   comp (reusable frame)
 *     ├─ label (text, "Click me")
 *     └─ icon  (rect)
 */

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

function buildNodes(): {
  nodesById: Record<string, FlatSceneNode>;
  childrenById: Record<string, string[]>;
} {
  const comp = {
    id: "comp",
    type: "frame",
    name: "Comp",
    reusable: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    properties: [showIconProp, labelProp],
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
    visible: true,
  } as unknown as FlatSceneNode;

  return {
    nodesById: { comp, label, icon },
    childrenById: { comp: ["label", "icon"] },
  };
}

describe("resolveRefToTree with component properties", () => {
  it("applies the component's default property values when the instance selects none", () => {
    const { nodesById, childrenById } = buildNodes();
    const ref: RefNode = { id: "inst", type: "ref", componentId: "comp", x: 0, y: 0, width: 100, height: 100 };

    const resolved = resolveRefToTree(ref, nodesById, childrenById)!;
    const label = resolved.children.find((c) => c.id === "label");
    const icon = resolved.children.find((c) => c.id === "icon");
    expect((label as { text?: string })?.text).toBe("Click me");
    expect(icon?.visible).not.toBe(false);
  });

  it("applies the instance's selected property values", () => {
    const { nodesById, childrenById } = buildNodes();
    const ref: RefNode = {
      id: "inst",
      type: "ref",
      componentId: "comp",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      propertyValues: { showIcon: false, label: "Buy now" },
    };

    const resolved = resolveRefToTree(ref, nodesById, childrenById)!;
    const label = resolved.children.find((c) => c.id === "label");
    const icon = resolved.children.find((c) => c.id === "icon");
    expect((label as { text?: string })?.text).toBe("Buy now");
    expect(icon?.visible).toBe(false);
  });

  it("switching a property value preserves the instance's other explicit overrides", () => {
    const { nodesById, childrenById } = buildNodes();
    const ref: RefNode = {
      id: "inst",
      type: "ref",
      componentId: "comp",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      overrides: { icon: { kind: "update", props: { x: 999 } } },
      propertyValues: { label: "Buy now" },
    };

    const resolved = resolveRefToTree(ref, nodesById, childrenById)!;
    const label = resolved.children.find((c) => c.id === "label");
    const icon = resolved.children.find((c) => c.id === "icon");
    expect((label as { text?: string })?.text).toBe("Buy now");
    expect(icon?.x).toBe(999);
  });

  it("an explicit override at the same path as a property wins over the property's value", () => {
    const { nodesById, childrenById } = buildNodes();
    const ref: RefNode = {
      id: "inst",
      type: "ref",
      componentId: "comp",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      overrides: { label: { kind: "update", props: { text: "Hard override" } as never } },
      propertyValues: { label: "From property" },
    };

    const resolved = resolveRefToTree(ref, nodesById, childrenById)!;
    const label = resolved.children.find((c) => c.id === "label");
    expect((label as { text?: string })?.text).toBe("Hard override");
  });
});
