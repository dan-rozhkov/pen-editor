import { describe, it, expect } from "vitest";
import {
  flattenRefNodes,
  flattenRefNodesAcrossPages,
  type FlatSceneMaps,
} from "../flattenRefNodes";
import type { FlatSceneNode } from "@/types/scene";

function maps(
  nodesById: Record<string, unknown>,
  parentById: Record<string, string | null>,
  childrenById: Record<string, string[]>,
  rootIds: string[],
): FlatSceneMaps {
  return {
    nodesById: nodesById as unknown as Record<string, FlatSceneNode>,
    parentById,
    childrenById,
    rootIds,
  };
}

describe("flattenRefNodes", () => {
  it("resolves a ref into a deep clone of its component, keeping the ref's geometry/name and dropping overrides", () => {
    const flat = maps(
      {
        comp1: { id: "comp1", type: "frame", name: "Button", x: 0, y: 0, width: 80, height: 40, reusable: true },
        compChild: { id: "compChild", type: "text", name: "Label", x: 10, y: 10, width: 60, height: 20, text: "Click" },
        ref1: {
          id: "ref1",
          type: "ref",
          name: "My Instance",
          x: 100,
          y: 200,
          width: 80,
          height: 40,
          componentId: "comp1",
          overrides: { compChild: { kind: "update", props: { text: "Overridden" } } },
          propertyValues: { foo: "bar" },
        },
      },
      { comp1: null, compChild: "comp1", ref1: null },
      { comp1: ["compChild"] },
      ["comp1", "ref1"],
    );

    const result = flattenRefNodes(flat);

    // The master component is untouched (still present, id preserved) but
    // stripped of the `reusable` flag.
    expect(result.nodesById.comp1.type).toBe("frame");
    expect((result.nodesById.comp1 as unknown as { reusable?: boolean }).reusable).toBeUndefined();

    // The ref keeps its own id; it's now a frame with the ref's own geometry/name.
    const resolved = result.nodesById.ref1 as unknown as {
      type: string;
      name?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      overrides?: unknown;
      propertyValues?: unknown;
      componentId?: string;
    };
    expect(resolved.type).toBe("frame");
    expect(resolved.name).toBe("My Instance");
    expect(resolved.x).toBe(100);
    expect(resolved.y).toBe(200);
    expect(resolved.width).toBe(80);
    expect(resolved.height).toBe(40);
    // overrides/propertyValues/componentId are dropped.
    expect(resolved.overrides).toBeUndefined();
    expect(resolved.propertyValues).toBeUndefined();
    expect(resolved.componentId).toBeUndefined();

    // The cloned descendant gets a FRESH id — never the original compChild id
    // (which is still owned by the master component).
    const clonedChildIds = result.childrenById.ref1;
    expect(clonedChildIds).toBeDefined();
    expect(clonedChildIds!.length).toBe(1);
    const clonedChildId = clonedChildIds![0];
    expect(clonedChildId).not.toBe("compChild");
    expect(result.nodesById[clonedChildId]).toBeDefined();
    expect((result.nodesById[clonedChildId] as unknown as { text: string }).text).toBe("Click");
    expect(result.parentById[clonedChildId]).toBe("ref1");

    // The master's own child is untouched.
    expect(result.nodesById.compChild).toBeDefined();
    expect(result.childrenById.comp1).toEqual(["compChild"]);
  });

  it("turns a ref with a dangling componentId into an empty plain frame at the ref's geometry", () => {
    const flat = maps(
      {
        ref1: {
          id: "ref1",
          type: "ref",
          name: "Orphan Instance",
          x: 5,
          y: 6,
          width: 30,
          height: 40,
          componentId: "does-not-exist",
        },
      },
      { ref1: null },
      {},
      ["ref1"],
    );

    const result = flattenRefNodes(flat);
    const resolved = result.nodesById.ref1 as unknown as {
      type: string;
      name?: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };
    expect(resolved.type).toBe("frame");
    expect(resolved.name).toBe("Orphan Instance");
    expect(resolved.x).toBe(5);
    expect(resolved.y).toBe(6);
    expect(resolved.width).toBe(30);
    expect(resolved.height).toBe(40);
    expect(result.childrenById.ref1).toBeUndefined();
  });

  it("resolves nested refs (a component instance inside another component's subtree)", () => {
    const flat = maps(
      {
        inner: { id: "inner", type: "frame", name: "Inner", x: 0, y: 0, width: 20, height: 20, reusable: true },
        outer: { id: "outer", type: "frame", name: "Outer", x: 0, y: 0, width: 100, height: 100, reusable: true },
        innerRefInsideOuter: {
          id: "innerRefInsideOuter",
          type: "ref",
          name: "Inner Instance",
          x: 5,
          y: 5,
          width: 20,
          height: 20,
          componentId: "inner",
        },
        topRef: {
          id: "topRef",
          type: "ref",
          name: "Outer Instance",
          x: 50,
          y: 50,
          width: 100,
          height: 100,
          componentId: "outer",
        },
      },
      { inner: null, outer: null, innerRefInsideOuter: "outer", topRef: null },
      { outer: ["innerRefInsideOuter"] },
      ["inner", "outer", "topRef"],
    );

    const result = flattenRefNodes(flat);

    const clonedChildIds = result.childrenById.topRef;
    expect(clonedChildIds).toBeDefined();
    expect(clonedChildIds!.length).toBe(1);
    const clonedInnerId = clonedChildIds![0];
    // The nested ref was resolved too — it's a frame now, not a `ref`.
    const clonedInner = result.nodesById[clonedInnerId] as unknown as { type: string; name?: string };
    expect(clonedInner.type).toBe("frame");
    expect(clonedInner.name).toBe("Inner Instance");
  });

  it("strips reusable/isSlot/properties from every frame, ref or not", () => {
    const flat = maps(
      {
        plain: {
          id: "plain",
          type: "frame",
          name: "Plain",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          reusable: true,
          isSlot: true,
          properties: [{ id: "p1", name: "Label", type: "text", defaultValue: "x", bindingPath: "a", bindingProp: "text" }],
        },
      },
      { plain: null },
      {},
      ["plain"],
    );

    const result = flattenRefNodes(flat);
    const plain = result.nodesById.plain as unknown as {
      reusable?: boolean;
      isSlot?: boolean;
      properties?: unknown;
    };
    expect(plain.reusable).toBeUndefined();
    expect(plain.isSlot).toBeUndefined();
    expect(plain.properties).toBeUndefined();
  });
});

describe("flattenRefNodesAcrossPages", () => {
  it("resolves an instance whose component master lives on another page", () => {
    // Page 1 holds the component; page 2 holds the only instance of it. The
    // editor used to inject cross-page component subtrees so this resolved;
    // migrating each page in isolation would blank the instance instead.
    const page1 = maps(
      {
        comp: { id: "comp", type: "frame", name: "Card", x: 0, y: 0, width: 200, height: 120, reusable: true },
        compChild: { id: "compChild", type: "text", name: "Title", x: 8, y: 8, width: 100, height: 20, text: "Hello" },
      },
      { comp: null, compChild: "comp" },
      { comp: ["compChild"] },
      ["comp"],
    );
    const page2 = maps(
      {
        inst: { id: "inst", type: "ref", name: "Card Instance", x: 40, y: 60, width: 200, height: 120, componentId: "comp" },
      },
      { inst: null },
      {},
      ["inst"],
    );

    const [migrated1, migrated2] = flattenRefNodesAcrossPages([page1, page2]);

    // The instance became a real frame carrying the component's content.
    const inst = migrated2.nodesById.inst as unknown as { type: string; name?: string; x: number; y: number };
    expect(inst.type).toBe("frame");
    expect(inst.name).toBe("Card Instance");
    expect(inst.x).toBe(40);
    expect(inst.y).toBe(60);

    const clonedIds = migrated2.childrenById.inst ?? [];
    expect(clonedIds).toHaveLength(1);
    const cloned = migrated2.nodesById[clonedIds[0]] as unknown as { type: string; name?: string };
    expect(cloned.type).toBe("text");
    expect(cloned.name).toBe("Title");
    // Fresh id — never reuses the master's descendant id.
    expect(clonedIds[0]).not.toBe("compChild");

    // The master page is untouched apart from losing `reusable`.
    const comp = migrated1.nodesById.comp as unknown as { reusable?: boolean };
    expect(comp.reusable).toBeUndefined();
    expect(migrated1.childrenById.comp).toEqual(["compChild"]);
  });

  it("returns an empty list unchanged", () => {
    expect(flattenRefNodesAcrossPages([])).toEqual([]);
  });
});
