import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { usePageStore } from "@/store/pageStore";
import {
  COMPONENTS_PAGE_NAME,
  duplicateKeyWarnings,
  selectComponentRegistry,
} from "@/store/componentRegistry";
import { installComponentSync } from "@/store/componentSync";
import {
  activeHtml,
  flushMicrotasks,
  parse,
  resetWorld,
  seedEmbed,
} from "@/test/componentFixtures";
import { BTN_HTML } from "@/lib/embedComponents/__tests__/fixtures";
import { defineComponent, deleteComponent } from "@/lib/tools/components";
import { editEmbedHtml } from "@/lib/tools/editEmbedHtml";
import { getEditorState } from "@/lib/tools/getEditorState";

vi.mock("@/store/componentRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/componentRegistry")>();
  return { ...actual, selectComponentRegistry: vi.fn(actual.selectComponentRegistry) };
});

const BTN_ARGS = { key: "btn", name: "Button", html: BTN_HTML, variants: { kind: ["primary", "secondary"] } };

function componentsPage() {
  return usePageStore.getState().pages.find((p) => p.name === COMPONENTS_PAGE_NAME)!;
}

describe("delete_component is undoable on the (inactive) Components page", () => {
  beforeEach(() => resetWorld());

  it("pushes a history entry, and undo on that page restores the master", async () => {
    seedEmbed("s1", "<p>screen</p>");
    await defineComponent(BTN_ARGS);
    const pageId = componentsPage().id;
    expect(componentsPage().history.past).toHaveLength(1);

    await deleteComponent({ key: "btn" });
    expect(componentsPage().rootIds).toHaveLength(0);
    expect(componentsPage().history.past).toHaveLength(2);

    usePageStore.getState().switchToPage(pageId);
    const past = useHistoryStore.getState().past;
    useSceneStore.getState().restoreSnapshot(past[past.length - 1]);
    expect(selectComponentRegistry().has("btn")).toBe(true);
  });
});

describe("component sync subscriber hot path", () => {
  let stop: () => void;
  beforeEach(async () => {
    resetWorld();
    stop = installComponentSync();
    seedEmbed("s1", "<main></main>");
    await defineComponent(BTN_ARGS);
    await editEmbedHtml({
      nodeId: "s1",
      edits: [{ oldString: "<main></main>", newString: "<main><c-btn>Go</c-btn></main>" }],
    });
    await flushMicrotasks();
    vi.mocked(selectComponentRegistry).mockClear();
  });
  afterEach(() => stop());

  it("does no reconcile and no registry rebuild for a position change of a consumer embed", async () => {
    useSceneStore.getState().updateNode("s1", { x: 120, y: 40 });
    await flushMicrotasks();
    expect(selectComponentRegistry).not.toHaveBeenCalled();
  });

  it("still reconciles when a consumer's html changes to a stale region", async () => {
    const stale = activeHtml("s1").replace(/data-c-rev="[^"]*"/, 'data-c-rev="old"');
    useSceneStore.getState().updateNode("s1", { htmlContent: stale } as never);
    await flushMicrotasks();
    expect(selectComponentRegistry).toHaveBeenCalled();
    expect(activeHtml("s1")).not.toContain('data-c-rev="old"');
  });
});

describe("duplicate masters", () => {
  beforeEach(() => resetWorld());

  it("duplicating the Components page strips component from the copies", async () => {
    seedEmbed("s1", "<p>x</p>");
    await defineComponent(BTN_ARGS);
    const original = componentsPage();
    const copyId = usePageStore.getState().duplicatePage(original.id);
    usePageStore.getState().switchToPage("p1");
    const copy = usePageStore.getState().pages.find((p) => p.id === copyId)!;
    const nodes = Object.values(copy.nodesById) as unknown as Array<{ component?: unknown }>;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].component).toBeUndefined();
    expect(duplicateKeyWarnings()).toEqual([]);
  });

  it("reports shadowed masters in get_editor_state and targets the winner on define", async () => {
    seedEmbed("s1", "<p>x</p>");
    await defineComponent(BTN_ARGS);
    const original = componentsPage();
    // Force a shadow copy (e.g. a hand-edited or legacy document).
    const [id, node] = Object.entries(original.nodesById)[0];
    usePageStore.setState((s) => ({
      pages: [
        ...s.pages,
        {
          ...original,
          id: "dup",
          name: "Copy",
          nodesById: { [id + "-2"]: { ...node, id: id + "-2" } },
          parentById: { [id + "-2"]: null },
          childrenById: {},
          rootIds: [id + "-2"],
        },
      ],
    }));
    expect(selectComponentRegistry().get("btn")?.nodeId).toBe(id);
    const state = parse(await getEditorState({}));
    const entry = (state.components as Array<{ warnings?: string[] }>)[0];
    expect(entry.warnings?.[0]).toMatch(/duplicate master/);

    const result = parse(await defineComponent({ ...BTN_ARGS, name: "Renamed" }));
    expect(result.nodeId).toBe(id);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/duplicate master/)]));
  });
});

describe("masters are consumers of the keys they contain", () => {
  beforeEach(() => resetWorld());

  it("editing btn updates card's stored nested region, then card instances in a screen", async () => {
    seedEmbed("s1", "<main></main>");
    await defineComponent(BTN_ARGS);
    const card = `<section data-c="card"><h3 data-c-slot="title">T</h3><c-btn>Go</c-btn></section>`;
    expect(parse(await defineComponent({ key: "card", name: "Card", html: card })).error).toBeUndefined();
    await editEmbedHtml({
      nodeId: "s1",
      edits: [{ oldString: "<main></main>", newString: "<main><c-card>Hi</c-card></main>" }],
    });
    const cardHtml = () => selectComponentRegistry().get("card")!.html;
    expect(cardHtml()).not.toContain('class="v2"');

    const result = parse(
      await defineComponent({ ...BTN_ARGS, html: BTN_HTML.replace("<button ", '<button class="v2" ') }),
    );
    expect(result.error).toBeUndefined();
    expect(cardHtml()).toContain('class="v2"');
    expect(activeHtml("s1")).toContain('class="v2"');
    expect(activeHtml("s1")).toContain(">Go<");
  });
});
