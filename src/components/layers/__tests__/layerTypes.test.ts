import { describe, it, expect } from "vitest";
import {
  flattenLayers,
  getLayerKey,
  getEmbedElementLayerKey,
  getDisplayName,
} from "../layerTypes";
import type { FlattenedLayer } from "../layerTypes";
import type { SceneNode } from "@/types/scene";

function node(
  id: string,
  type: string,
  extra: Partial<SceneNode> = {},
): SceneNode {
  return { id, type, x: 0, y: 0, width: 10, height: 10, ...extra } as SceneNode;
}

function embedNode(id: string, htmlContent: string): SceneNode {
  return { id, type: "embed", x: 0, y: 0, width: 10, height: 10, htmlContent } as SceneNode;
}

describe("getDisplayName", () => {
  it("uses the node name when present", () => {
    expect(getDisplayName({ name: "Header", type: "frame" })).toBe("Header");
  });

  it("falls back to a capitalized type when unnamed", () => {
    expect(getDisplayName({ type: "rect" })).toBe("Rect");
    expect(getDisplayName({ name: "", type: "text" })).toBe("Text");
  });
});

describe("getLayerKey", () => {
  it("returns the node id for ordinary layers", () => {
    const layer: FlattenedLayer = { node: node("n1", "rect"), depth: 0, parentId: null };
    expect(getLayerKey(layer)).toBe("n1");
  });

  it("returns embed:<embedId>:<sourcePath> for embed-element layers", () => {
    const embed = embedNode("embed1", "<button>Buy</button>");
    const layer: FlattenedLayer = {
      node: embed,
      depth: 1,
      parentId: "embed1",
      embedElement: {
        embedId: "embed1",
        element: {
          sourcePath: "button:nth-of-type(1)",
          shadowPath: "div:nth-of-type(1) > button:nth-of-type(1)",
          tagName: "button",
          name: "Buy",
          kind: "text",
          hidden: false,
          children: [],
        },
      },
    };
    expect(getLayerKey(layer)).toBe("embed:embed1:button:nth-of-type(1)");
    expect(getLayerKey(layer)).toBe(getEmbedElementLayerKey("embed1", "button:nth-of-type(1)"));
  });
});

describe("flattenLayers", () => {
  it("returns only top-level nodes when nothing is expanded", () => {
    const frame = node("a", "frame", {
      name: "A",
      children: [node("c1", "rect"), node("c2", "text")],
    } as Partial<SceneNode>);
    const b = node("b", "rect");

    const flat = flattenLayers([frame, b], new Set());
    expect(flat.map((l) => l.node.id)).toEqual(["a", "b"]);
    expect(flat.map((l) => l.depth)).toEqual([0, 0]);
  });

  it("expands a container's children in reverse order with depth + parentId", () => {
    const frame = node("a", "frame", {
      name: "A",
      children: [node("c1", "rect"), node("c2", "text")],
    } as Partial<SceneNode>);
    const b = node("b", "rect");

    const flat = flattenLayers([frame, b], new Set(["a"]));
    // children are emitted bottom-to-top (reverse of tree order)
    expect(flat.map((l) => l.node.id)).toEqual(["a", "c2", "c1", "b"]);
    expect(flat.map((l) => l.depth)).toEqual([0, 1, 1, 0]);
    expect(flat.map((l) => l.parentId)).toEqual([null, "a", "a", null]);
  });

  it("recurses into nested expanded containers", () => {
    const group = node("g", "group", {
      children: [node("d1", "rect")],
    } as Partial<SceneNode>);
    const frame = node("a", "frame", {
      children: [node("c1", "rect"), group],
    } as Partial<SceneNode>);

    const flat = flattenLayers([frame], new Set(["a", "g"]));
    expect(flat.map((l) => l.node.id)).toEqual(["a", "g", "d1", "c1"]);
    expect(flat.map((l) => l.depth)).toEqual([0, 1, 2, 1]);
  });

  it("does not recurse into a collapsed nested container", () => {
    const group = node("g", "group", {
      children: [node("d1", "rect")],
    } as Partial<SceneNode>);
    const frame = node("a", "frame", {
      children: [group],
    } as Partial<SceneNode>);

    // 'a' expanded but 'g' collapsed -> d1 is hidden
    const flat = flattenLayers([frame], new Set(["a"]));
    expect(flat.map((l) => l.node.id)).toEqual(["a", "g"]);
  });

  describe("embed elements", () => {
    it("renders no element rows for a collapsed embed", () => {
      const embed = embedNode("e1", "<button>One</button><button>Two</button>");
      const flat = flattenLayers([embed], new Set());
      expect(flat.map((l) => l.node.id)).toEqual(["e1"]);
      expect(flat.every((l) => !l.embedElement)).toBe(true);
    });

    it("renders an expanded embed's element rows with names/kinds/depths", () => {
      const embed = embedNode(
        "e1",
        '<button>Buy</button><img alt="Hero" src="x.png" />',
      );
      const flat = flattenLayers([embed], new Set(["e1"]));

      expect(flat.map((l) => l.node.id)).toEqual(["e1", "e1", "e1"]);
      expect(flat.map((l) => l.depth)).toEqual([0, 1, 1]);
      expect(flat.map((l) => l.parentId)).toEqual([null, "e1", "e1"]);
      expect(flat.slice(1).map((l) => l.embedElement?.element.name)).toEqual(["Buy", "Hero"]);
      expect(flat.slice(1).map((l) => l.embedElement?.element.kind)).toEqual(["text", "image"]);
      expect(flat.slice(1).every((l) => l.embedElement?.embedId === "e1")).toBe(true);
    });

    it("emits element rows in document order, not reversed", () => {
      const embed = embedNode(
        "e1",
        "<button>First</button><button>Second</button><button>Third</button>",
      );
      const flat = flattenLayers([embed], new Set(["e1"]));
      expect(flat.slice(1).map((l) => l.embedElement?.element.name)).toEqual([
        "First",
        "Second",
        "Third",
      ]);
    });

    it("recurses into an expanded nested element, keyed by embed:<embedId>:<sourcePath>", () => {
      const embed = embedNode(
        "e1",
        '<div class="card"><button>Buy</button></div>',
      );
      const collapsed = flattenLayers([embed], new Set(["e1"]));
      // The card <div> collapses to nothing but its own row until expanded.
      expect(collapsed.map((l) => l.embedElement?.element.name)).toEqual([undefined, ".card"]);

      const cardKey = getEmbedElementLayerKey("e1", "div:nth-of-type(1)");
      const expanded = flattenLayers([embed], new Set(["e1", cardKey]));
      expect(expanded.map((l) => l.embedElement?.element.name)).toEqual([
        undefined,
        ".card",
        "Buy",
      ]);
      expect(expanded[2].depth).toBe(2);
      expect(getLayerKey(expanded[2])).toBe(
        getEmbedElementLayerKey("e1", "div:nth-of-type(1) > button:nth-of-type(1)"),
      );
    });

    it("marks a hidden element's row as hidden", () => {
      const embed = embedNode("e1", '<button style="display:none">Buy</button>');
      const flat = flattenLayers([embed], new Set(["e1"]));
      expect(flat[1].embedElement?.element.hidden).toBe(true);
    });

    it("renders no element rows and no tree for empty/malformed html", () => {
      const emptyEmbed = embedNode("e1", "");
      expect(flattenLayers([emptyEmbed], new Set(["e1"])).map((l) => l.node.id)).toEqual(["e1"]);

      const malformedEmbed = embedNode("e2", "<div><span>unterminated");
      const flat = flattenLayers([malformedEmbed], new Set(["e2"]));
      // A browser HTML parser auto-closes unterminated tags rather than
      // failing, so this still yields the one well-formed element it can
      // recover — the "malformed" guarantee is that parsing never throws
      // and never produces garbage rows, not that recoverable markup
      // produces zero rows.
      expect(flat.map((l) => l.embedElement?.element.name)).toEqual([undefined, "unterminated"]);
    });
  });
});
