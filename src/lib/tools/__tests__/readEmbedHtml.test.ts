import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";
import { readEmbedHtml } from "../readEmbedHtml";

function seedEmbed(id: string, htmlContent: string, extra: Record<string, unknown> = {}) {
  const node = {
    id, type: "embed", name: "Screen", x: 0, y: 0, width: 390, height: 844, htmlContent, ...extra,
  } as unknown as FlatSceneNode;
  const state = useSceneStore.getState();
  useSceneStore.setState({
    nodesById: { ...state.nodesById, [id]: node },
    parentById: { ...state.parentById, [id]: null },
    rootIds: [...state.rootIds, id],
    _cachedTree: null,
  });
}

describe("readEmbedHtml", () => {
  beforeEach(() => resetStores());

  it("defaults to outline mode", async () => {
    seedEmbed("e1", '<div class="screen"><p>Hello</p></div>');
    const result = JSON.parse(await readEmbedHtml({ nodeId: "e1" }));
    expect(result.mode).toBe("outline");
    expect(result.outline).toContain('<div class="screen">');
  });

  it("greps with context and reports the match count", async () => {
    seedEmbed("e1", "a\n<button>Buy</button>\nb");
    const result = JSON.parse(await readEmbedHtml({ nodeId: "e1", mode: "grep", pattern: "Buy" }));
    expect(result.matches).toBe(1);
    expect(result.blocks.join("\n")).toContain("<button>Buy</button>");
  });

  it("errors when grep is called without a pattern", async () => {
    seedEmbed("e1", "<p>x</p>");
    const result = JSON.parse(await readEmbedHtml({ nodeId: "e1", mode: "grep" }));
    expect(result.error).toMatch(/pattern/);
  });

  it("returns the whole document in full mode", async () => {
    seedEmbed("e1", "<p>x</p>");
    const result = JSON.parse(await readEmbedHtml({ nodeId: "e1", mode: "full" }));
    expect(result.html).toBe("<p>x</p>");
  });

  it("warns on very large documents in full mode", async () => {
    seedEmbed("e1", `<p>${"x".repeat(20001)}</p>`);
    const result = JSON.parse(await readEmbedHtml({ nodeId: "e1", mode: "full" }));
    expect(result.warning).toMatch(/grep/);
  });

  it("reads sourceTemplate when present, since that is what edits target", async () => {
    seedEmbed("e1", "<div>EXPANDED</div>", { sourceTemplate: "<div>TEMPLATE</div>" });
    const result = JSON.parse(await readEmbedHtml({ nodeId: "e1", mode: "full" }));
    expect(result.html).toBe("<div>TEMPLATE</div>");
    expect(result.targetedSourceTemplate).toBe(true);
  });

  it("rejects a non-embed node", async () => {
    const state = useSceneStore.getState();
    useSceneStore.setState({
      nodesById: {
        ...state.nodesById,
        r1: { id: "r1", type: "rect", name: "Box", x: 0, y: 0, width: 1, height: 1 } as unknown as FlatSceneNode,
      },
      rootIds: [...state.rootIds, "r1"],
    });
    const result = JSON.parse(await readEmbedHtml({ nodeId: "r1" }));
    expect(result.error).toMatch(/not an embed/);
  });

  it("rejects an unknown node", async () => {
    const result = JSON.parse(await readEmbedHtml({ nodeId: "ghost" }));
    expect(result.error).toMatch(/not found/);
  });
});
