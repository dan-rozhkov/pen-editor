import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";
import { BTN_HTML } from "@/lib/embedComponents/__tests__/fixtures";
import { validateMaster, expandComponentTags } from "@/lib/embedComponents";
import { selectComponentRegistry } from "@/store/componentRegistry";
import type { SceneNode } from "@/types/scene";
import { editEmbedHtml } from "../editEmbedHtml";
import { readEmbedHtml } from "../readEmbedHtml";

function seed(id: string, htmlContent: string, extra: Record<string, unknown> = {}) {
  useSceneStore.getState().addNode({
    id, type: "embed", name: id, x: 0, y: 0, width: 390, height: 844, htmlContent, ...extra,
  } as unknown as SceneNode);
}

function seedScreen(): string {
  const result = validateMaster(BTN_HTML, "btn", { kind: ["primary", "secondary"] });
  if (!result.ok) throw new Error(result.errors.join(";"));
  seed("m1", result.master.html, { component: { key: "btn", name: "Button", variants: { kind: ["primary", "secondary"] } } });
  const html = expandComponentTags(`<main><h1>Title</h1><c-btn kind="secondary">Cancel</c-btn></main>`, selectComponentRegistry()).html;
  seed("s1", html);
  return html;
}

const stored = (id: string) => (useSceneStore.getState().nodesById[id] as unknown as { htmlContent: string }).htmlContent;

describe("compact view", () => {
  beforeEach(() => resetStores());

  it("read_embed_html defaults to compact tags and honours view:expanded", async () => {
    seedScreen();
    const compact = JSON.parse(await readEmbedHtml({ nodeId: "s1", mode: "full" }));
    expect(compact.view).toBe("compact");
    expect(compact.html).toContain('<c-btn kind="secondary">Cancel</c-btn>');
    expect(compact.html).not.toContain("data-c=");
    const grep = JSON.parse(await readEmbedHtml({ nodeId: "s1", mode: "grep", pattern: "<c-btn" }));
    expect(grep.matches).toBe(1);
    const expanded = JSON.parse(await readEmbedHtml({ nodeId: "s1", mode: "full", view: "expanded" }));
    expect(expanded.view).toBe("expanded");
    expect(expanded.html).toContain('data-c="btn"');
  });

  it("reads a master as stored", async () => {
    seedScreen();
    const res = JSON.parse(await readEmbedHtml({ nodeId: "m1", mode: "full" }));
    expect(res.view).toBe("expanded");
    expect(res.html).toContain('data-c="btn"');
  });

  it("edit_embed_html matches compact anchors, then expands", async () => {
    seedScreen();
    const res = JSON.parse(await editEmbedHtml({
      nodeId: "s1",
      edits: [{ oldString: '<c-btn kind="secondary">Cancel</c-btn>', newString: '<c-btn kind="primary">Save</c-btn>' }],
    }));
    expect(res.error).toBeUndefined();
    expect(res.issues).toEqual([]);
    expect(stored("s1")).toContain('data-v-kind="primary"');
    expect(stored("s1")).toContain(">Save<");
    expect(stored("s1")).toContain('data-c-style="btn"');
  });

  it("falls back to the expanded view for an expanded-only anchor and says so", async () => {
    seedScreen();
    const res = JSON.parse(await editEmbedHtml({
      nodeId: "s1",
      edits: [{ oldString: '<span data-c-slot="label">Cancel</span>', newString: '<span data-c-slot="label">Close</span>' }],
    }));
    expect(res.error).toBeUndefined();
    expect(res.issues.join(" ")).toContain("expanded view");
    expect(stored("s1")).toContain(">Close<");
  });

  it("view:expanded applies anchors to the expanded text without the note", async () => {
    seedScreen();
    const res = JSON.parse(await editEmbedHtml({
      nodeId: "s1",
      view: "expanded",
      edits: [{ oldString: '<span data-c-slot="label">Cancel</span>', newString: '<span data-c-slot="label">Close</span>' }],
    }));
    expect(res.error).toBeUndefined();
    expect(res.issues).toEqual([]);
    expect(stored("s1")).toContain(">Close<");
  });

  it("edits outside components leave the regions byte-identical", async () => {
    const before = seedScreen();
    const res = JSON.parse(await editEmbedHtml({ nodeId: "s1", edits: [{ oldString: "<h1>Title</h1>", newString: "<h1>New</h1>" }] }));
    expect(res.error).toBeUndefined();
    expect(stored("s1")).toBe(before.replace("<h1>Title</h1>", "<h1>New</h1>"));
  });
});
