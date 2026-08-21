import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";
import { editEmbedHtml } from "../editEmbedHtml";

function seedEmbed(id: string, htmlContent: string, extra: Record<string, unknown> = {}) {
  const node = {
    id,
    type: "embed",
    name: "Screen",
    x: 0,
    y: 0,
    width: 390,
    height: 844,
    htmlContent,
    ...extra,
  } as unknown as FlatSceneNode;
  const state = useSceneStore.getState();
  useSceneStore.setState({
    nodesById: { ...state.nodesById, [id]: node },
    parentById: { ...state.parentById, [id]: null },
    rootIds: [...state.rootIds, id],
    _cachedTree: null,
  });
}

const html = (id: string) => useSceneStore.getState().nodesById[id] as unknown as { htmlContent: string };

describe("editEmbedHtml", () => {
  beforeEach(() => resetStores());

  it("applies a unique edit and reports it", async () => {
    seedEmbed("e1", '<button class="cta">Buy</button>');
    const result = JSON.parse(await editEmbedHtml({
      nodeId: "e1",
      edits: [{ oldString: ">Buy<", newString: ">Get started<" }],
    }));
    expect(result.error).toBeUndefined();
    expect(result.editsApplied).toBe(1);
    expect(result.replacements).toBe(1);
    expect(html("e1").htmlContent).toBe('<button class="cta">Get started</button>');
  });

  it("leaves the store untouched when the anchor is ambiguous", async () => {
    seedEmbed("e1", "<i></i><i></i>");
    const result = JSON.parse(await editEmbedHtml({
      nodeId: "e1",
      edits: [{ oldString: "<i>", newString: "<b>" }],
    }));
    expect(result.error).toMatch(/occurs 2 times/);
    expect(html("e1").htmlContent).toBe("<i></i><i></i>");
  });

  it("reports a missing anchor and points at grep", async () => {
    seedEmbed("e1", "<p>hi</p>");
    const result = JSON.parse(await editEmbedHtml({
      nodeId: "e1",
      edits: [{ oldString: "nope", newString: "x" }],
    }));
    expect(result.error).toMatch(/read_embed_html/);
    expect(html("e1").htmlContent).toBe("<p>hi</p>");
  });

  it("replaces every occurrence with replaceAll", async () => {
    seedEmbed("e1", "#111 and #111");
    const result = JSON.parse(await editEmbedHtml({
      nodeId: "e1",
      edits: [{ oldString: "#111", newString: "#222", replaceAll: true }],
    }));
    expect(result.replacements).toBe(2);
    expect(html("e1").htmlContent).toBe("#222 and #222");
  });

  it("is atomic: a failing second edit rolls back the first", async () => {
    seedEmbed("e1", "a-b");
    await editEmbedHtml({
      nodeId: "e1",
      edits: [
        { oldString: "a", newString: "x" },
        { oldString: "zzz", newString: "y" },
      ],
    });
    expect(html("e1").htmlContent).toBe("a-b");
  });

  it("edits sourceTemplate rather than the expanded htmlContent", async () => {
    seedEmbed("e1", "<div>EXPANDED</div>", { sourceTemplate: "<div>TEMPLATE</div>" });
    const result = JSON.parse(await editEmbedHtml({
      nodeId: "e1",
      edits: [{ oldString: "TEMPLATE", newString: "EDITED" }],
    }));
    expect(result.targetedSourceTemplate).toBe(true);
    // No document components exist in this scene, so nothing expands and the
    // edited template becomes the stored html; the stale template is dropped.
    expect(html("e1").htmlContent).toBe("<div>EDITED</div>");
  });

  it("rejects a non-embed node with an actionable message", async () => {
    const state = useSceneStore.getState();
    useSceneStore.setState({
      nodesById: {
        ...state.nodesById,
        r1: { id: "r1", type: "rect", name: "Box", x: 0, y: 0, width: 10, height: 10 } as unknown as FlatSceneNode,
      },
      rootIds: [...state.rootIds, "r1"],
    });
    const result = JSON.parse(await editEmbedHtml({ nodeId: "r1", edits: [{ oldString: "a", newString: "b" }] }));
    expect(result.error).toMatch(/not an embed/);
  });

  it("rejects an unknown node", async () => {
    const result = JSON.parse(await editEmbedHtml({ nodeId: "ghost", edits: [{ oldString: "a", newString: "b" }] }));
    expect(result.error).toMatch(/not found/);
  });

  it("rejects an empty edits list", async () => {
    seedEmbed("e1", "<p>hi</p>");
    const result = JSON.parse(await editEmbedHtml({ nodeId: "e1", edits: [] }));
    expect(result.error).toMatch(/No edits/);
  });

  it("applies a whitespace-drifted anchor and reports it as normalized", async () => {
    seedEmbed("e1", "<div>\n  <p>\n    hi\n  </p>\n</div>");
    const result = JSON.parse(
      await editEmbedHtml({
        nodeId: "e1",
        edits: [{ oldString: "<p> hi </p>", newString: "<p>bye</p>" }],
      }),
    );
    expect(result.error).toBeUndefined();
    expect(result.normalizedMatches).toBe(1);
    expect(html("e1").htmlContent).toBe("<div>\n  <p>bye</p>\n</div>");
  });

  it("rejects an edit that breaks tag structure and leaves the store untouched", async () => {
    const source = '<div class="top-bar"><span>title</span></div><div class="map-mini"></div>';
    seedEmbed("e1", source);
    const result = JSON.parse(
      await editEmbedHtml({
        nodeId: "e1",
        edits: [{ oldString: "</span></div><div", newString: "</span><div" }],
      }),
    );
    expect(result.error).toMatch(/unclosed/);
    expect(html("e1").htmlContent).toBe(source);
  });

  it("still allows editing a screen that was already unbalanced before the edit", async () => {
    const source = '<div class="top-bar"><span>title</span><div class="map-mini"></div>';
    seedEmbed("e1", source);
    const result = JSON.parse(
      await editEmbedHtml({
        nodeId: "e1",
        edits: [{ oldString: "title", newString: "renamed" }],
      }),
    );
    expect(result.error).toBeUndefined();
    expect(html("e1").htmlContent).toBe(
      '<div class="top-bar"><span>renamed</span><div class="map-mini"></div>',
    );
  });

  it("records exactly one undo entry", async () => {
    seedEmbed("e1", "<p>a</p>");
    const before = useHistoryStore.getState().past.length;
    await editEmbedHtml({ nodeId: "e1", edits: [{ oldString: "a", newString: "b" }] });
    expect(useHistoryStore.getState().past.length).toBe(before + 1);
  });
});

describe("editEmbedHtml and document component tags", () => {
  beforeEach(() => resetStores());

  it("refuses the edit when a component tag in the template no longer resolves", async () => {
    // The component was renamed or deleted, so <c-user-card/> expands to nothing.
    // Storing the unexpanded template would wipe the card's rendered markup.
    seedEmbed("e1", "<div><span>card markup</span></div>", {
      sourceTemplate: "<div><c-user-card/></div>",
    });
    const result = JSON.parse(
      await editEmbedHtml({
        nodeId: "e1",
        edits: [{ oldString: "<div>", newString: '<div class="wrap">' }],
      }),
    );
    expect(result.error).toMatch(/no longer resolve/);
    expect(html("e1").htmlContent).toBe("<div><span>card markup</span></div>");
    expect(
      (useSceneStore.getState().nodesById.e1 as unknown as { sourceTemplate?: string }).sourceTemplate,
    ).toBe("<div><c-user-card/></div>");
  });

  it("drops the template when the edit removes the last component tag", async () => {
    seedEmbed("e1", "<div><span>card markup</span></div>", {
      sourceTemplate: "<div><c-user-card/></div>",
    });
    const result = JSON.parse(
      await editEmbedHtml({
        nodeId: "e1",
        edits: [{ oldString: "<c-user-card/>", newString: "<p>plain</p>" }],
      }),
    );
    expect(result.error).toBeUndefined();
    expect(html("e1").htmlContent).toBe("<div><p>plain</p></div>");
    expect(
      (useSceneStore.getState().nodesById.e1 as unknown as { sourceTemplate?: string }).sourceTemplate,
    ).toBeUndefined();
  });
});

describe("editEmbedHtml false-positive component tags", () => {
  beforeEach(() => resetStores());

  it("stores plain html when a screen without a template merely contains '<c-' text", async () => {
    seedEmbed("e1", "<script>for (let i = 0; i<c-1; i++) {}</script><p>hi</p>");
    const result = JSON.parse(
      await editEmbedHtml({ nodeId: "e1", edits: [{ oldString: "<p>hi</p>", newString: "<p>bye</p>" }] }),
    );
    expect(result.error).toBeUndefined();
    expect(html("e1").htmlContent).toBe("<script>for (let i = 0; i<c-1; i++) {}</script><p>bye</p>");
  });
});

describe("editEmbedHtml Phosphor icon warnings", () => {
  beforeEach(() => {
    resetStores();
  });

  it("warns about an unknown icon class the edit introduced", async () => {
    seedEmbed("e1", '<i class="ph ph-timer"></i>');
    const result = JSON.parse(
      await editEmbedHtml({
        nodeId: "e1",
        edits: [{ oldString: "ph-timer", newString: "ph-stopwatch" }],
      }),
    ) as { issues: string[] };

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('Unknown Phosphor icon "ph-stopwatch"');
    expect(result.issues[0]).toContain("blank space");
  });

  it("stays quiet about a bad icon name the edit did not introduce", async () => {
    seedEmbed("e1", '<i class="ph ph-stopwatch"></i><p>hello</p>');
    const result = JSON.parse(
      await editEmbedHtml({
        nodeId: "e1",
        edits: [{ oldString: "<p>hello</p>", newString: "<p>bye</p>" }],
      }),
    ) as { issues: string[] };

    // The screen is still wrong, but this edit did not touch it — re-reporting
    // it every time reads as "your edit broke this".
    expect(result.issues).toEqual([]);
  });

  it("does not warn about a valid icon class", async () => {
    seedEmbed("e1", '<i class="ph ph-timer"></i>');
    const result = JSON.parse(
      await editEmbedHtml({
        nodeId: "e1",
        edits: [{ oldString: "ph-timer", newString: "ph-funnel" }],
      }),
    ) as { issues: string[] };

    expect(result.issues).toEqual([]);
  });
});
