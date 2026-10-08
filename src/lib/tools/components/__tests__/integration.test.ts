import { describe, it, expect, beforeEach } from "vitest";
import { batchDesign } from "@/lib/tools/batchDesign";
import { getEditorState } from "@/lib/tools/getEditorState";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { deserializeDocument, serializeDocument } from "@/utils/fileUtils";
import { serializePublicPenDocument } from "@/utils/publicPenExport";
import { resolveSlideOrder } from "@/utils/slideOrder";
import { cloneNodeWithNewId } from "@/utils/cloneNode";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { usePageStore } from "@/store/pageStore";
import { computeRev } from "@/lib/embedComponents";
import { selectComponentRegistry } from "@/store/componentRegistry";
import { reconcileConsumers } from "@/store/componentSync";
import { consumeDirty } from "@/store/sceneStore/dirtyTracking";
import { BTN_HTML } from "@/lib/embedComponents/__tests__/fixtures";
import type { EmbedNode, FlatSceneNode, SceneNode } from "@/types/scene";
import {
  activeHtml,
  pageHtml,
  parse,
  resetWorld,
  seedEmbed,
  seedInactivePage,
} from "@/test/componentFixtures";
import { defineComponent } from "..";

async function defineBtn() {
  return parse(
    await defineComponent({
      key: "btn",
      name: "Button",
      html: BTN_HTML,
      variants: { kind: ["primary", "secondary"] },
    }),
  );
}

const q = (s: string) => JSON.stringify(s);

describe("batch_design with components", () => {
  beforeEach(async () => {
    resetWorld();
    await defineBtn();
  });

  it("expands registered tags in a created embed and reports unknown ones", async () => {
    const result = JSON.parse(
      await batchDesign({
        operations:
          `e=I(document, {type: "embed", name: "Home", width: 390, height: 844, htmlContent: ` +
          q(`<main><c-btn kind="secondary">Cancel</c-btn><c-ghost>x</c-ghost></main>`) +
          `})`,
      }),
    );
    expect(result.success).toBe(true);
    const html = activeHtml(result.createdNodes[0].id);
    expect(html).toContain('<button data-c="btn" data-v-kind="secondary"');
    expect(html).toContain('<style data-c-style="btn">');
    expect(html).toContain("<c-ghost>x</c-ghost>");
    expect(JSON.stringify(result)).toMatch(/<c-ghost>/);
  });

  it("allows a slot update but refuses a managed-zone update to an existing embed", async () => {
    const created = JSON.parse(
      await batchDesign({
        operations:
          `e=I(document, {type: "embed", name: "Home", width: 390, height: 844, htmlContent: ` +
          q(`<main><c-btn>Cancel</c-btn></main>`) +
          `})`,
      }),
    );
    const id = created.createdNodes[0].id as string;
    const before = activeHtml(id);

    const okUpdate = JSON.parse(
      await batchDesign({
        operations: `U(${q(id)}, {htmlContent: ${q(before.replace(">Cancel<", ">Back<"))}})`,
      }),
    );
    expect(okUpdate.success).toBe(true);
    expect(activeHtml(id)).toContain(">Back<");

    const tampered = activeHtml(id).replace("<span", "<em>!</em><span");
    const refused = JSON.parse(
      await batchDesign({ operations: `U(${q(id)}, {htmlContent: ${q(tampered)}})` }),
    );
    expect(refused.success).not.toBe(true);
    expect(JSON.stringify(refused)).toContain("region `btn` is component-managed; edit the master or detach it");
    expect(activeHtml(id)).toContain(">Back<");
    expect(activeHtml(id)).not.toContain("<em>");
  });

  it("validates a master updated through U() (master on the active page)", async () => {
    resetWorld();
    usePageStore.setState((s) => ({ pages: s.pages.map((p) => ({ ...p, name: "Components" })) }));
    await defineBtn();
    const nodeId = selectComponentRegistry().get("btn")!.nodeId as string;
    const bad = JSON.parse(
      await batchDesign({ operations: `U(${q(nodeId)}, {htmlContent: ${q("<div></div><div></div>")}})` }),
    );
    expect(bad.success).not.toBe(true);
    expect(JSON.stringify(bad)).toMatch(/exactly one root/);
  });
});

describe("get_editor_state components", () => {
  beforeEach(() => resetWorld());

  it("omits the key entirely when there are no components", async () => {
    seedEmbed("s1", "<p>x</p>");
    const state = JSON.parse(await getEditorState({}));
    expect("components" in state).toBe(false);
  });

  it("lists key, name, status, variants, slots and usedBy", async () => {
    await defineBtn();
    seedEmbed("s1", "<main></main>");
    seedInactivePage("p2", "Other", { s2: "<main></main>" });
    reconcileConsumers(); // no-op, nothing references btn yet
    const region = (await import("@/lib/embedComponents")).renderInstance(
      selectComponentRegistry().get("btn")!,
      { slots: { label: "Go" } },
    );
    useSceneStore.getState().updateNode("s1", { htmlContent: `<main>${region}${region}</main>` } as never);
    usePageStore.setState((s) => ({
      pages: s.pages.map((p) =>
        p.id === "p2" ? { ...p, nodesById: { ...p.nodesById, s2: { ...p.nodesById.s2, htmlContent: region } as never } } : p,
      ),
    }));

    const state = JSON.parse(await getEditorState({}));
    expect(state.components).toEqual([
      {
        key: "btn",
        name: "Button",
        status: "stable",
        variants: { kind: ["primary", "secondary"] },
        slots: ["label"],
        usedBy: 2,
      },
    ]);
  });
});

describe("persistence and history", () => {
  beforeEach(() => resetWorld());

  it("round-trips a master's component meta through .pen save and load", () => {
    const node = {
      id: "m1", type: "embed", name: "Button", x: 0, y: 0, width: 100, height: 40,
      htmlContent: "<button data-c=\"btn\"></button>",
      component: { key: "btn", name: "Button", variants: { kind: ["a", "b"] }, status: "draft" as const },
    } as unknown as SceneNode;
    const json = serializeDocument([{ id: "p1", name: "Components", nodes: [node], pageBackground: "#f5f5f5" }], [], "light");
    const loaded = deserializeDocument(json);
    expect((loaded.pages[0].nodes[0] as EmbedNode).component).toEqual({
      key: "btn", name: "Button", variants: { kind: ["a", "b"] }, status: "draft",
    });
  });

  it("applyOpenedDocument catches stale regions up on every page", async () => {
    await defineBtn();
    seedEmbed("s1", "<main></main>");
    const registry = selectComponentRegistry();
    const master = registry.get("btn")!;
    const rev = computeRev(master);
    const staleRegion = `<button data-c="btn" data-v-kind="secondary" data-c-rev="00000000"><span data-c-slot="label">Old</span></button>`;

    const masterNode = {
      id: "m1", type: "embed", name: "Button", x: 0, y: 0, width: 100, height: 40,
      htmlContent: master.html, component: master.meta,
    } as unknown as SceneNode;
    const screen = (id: string) =>
      ({ id, type: "embed", name: id, x: 0, y: 0, width: 390, height: 844, htmlContent: `<main>${staleRegion}</main>` }) as unknown as SceneNode;

    applyOpenedDocument(
      {
        pages: [
          { id: "pa", name: "Screens", nodes: [screen("a")], pageBackground: "#f5f5f5" },
          { id: "pb", name: "More", nodes: [screen("b")], pageBackground: "#f5f5f5" },
          { id: "pc", name: "Components", nodes: [masterNode], pageBackground: "#f5f5f5" },
        ],
        variables: [],
        activeTheme: "light",
      } as never,
      { viewportWidth: 1000, viewportHeight: 800 },
    );

    expect(activeHtml("a")).toContain(`data-c-rev="${rev}"`);
    expect(activeHtml("a")).toContain(">Old<");
    expect(pageHtml("pb", "b")).toContain(`data-c-rev="${rev}"`);
    expect(pageHtml("pb", "b")).toContain('<style data-c-style="btn">');
  });

  it("carries the master's component meta in history snapshots", () => {
    usePageStore.setState((s) => ({ pages: s.pages.map((p) => ({ ...p, name: "Components" })) }));
    seedEmbed("m1", "<button data-c=\"btn\"></button>", { component: { key: "btn", name: "Button" } });
    useSceneStore.getState().updateNode("m1", { name: "Renamed" } as never);
    const snapshot = useHistoryStore.getState().past[0];
    expect((snapshot.nodesById.m1 as unknown as EmbedNode).component?.key).toBe("btn");
  });

  it("marks reconciled consumers dirty for the Pixi diff (no full-scan fallback)", async () => {
    await defineBtn();
    seedEmbed("s1", "<main></main>");
    const region = (await import("@/lib/embedComponents")).renderInstance(
      selectComponentRegistry().get("btn")!,
      {},
    );
    useSceneStore.getState().updateNode("s1", { htmlContent: region.replace(/ data-c-rev="[^"]*"/, "") } as never);
    consumeDirty(); // drain
    const n = reconcileConsumers({ keys: ["btn"] });
    expect(n).toBe(1);
    const dirty = consumeDirty();
    expect(dirty.complete).toBe(true);
    expect([...dirty.ids]).toEqual(["s1"]);
  });
});

describe("masters are not designs", () => {
  const master = (id: string) =>
    ({
      id, type: "embed", name: id, x: 0, y: 0, width: 100, height: 40,
      htmlContent: "<i data-c=\"x\"></i>", component: { key: "x", name: "X" },
    }) as unknown as FlatSceneNode;
  const screen = (id: string) =>
    ({ id, type: "embed", name: id, x: 0, y: 0, width: 100, height: 40, htmlContent: "<p></p>" }) as unknown as FlatSceneNode;

  it("slides skip masters but keep ordinary embeds", () => {
    const nodes = { m: master("m"), s: screen("s") };
    expect(resolveSlideOrder(nodes, ["m", "s"], [])).toEqual(["s"]);
  });

  it("the public .pen export drops masters, at the root and inside frames", () => {
    const frame = {
      id: "f", type: "frame", name: "F", x: 0, y: 0, width: 10, height: 10,
      children: [master("m2") as unknown as SceneNode, screen("s2") as unknown as SceneNode],
    } as unknown as SceneNode;
    const json = JSON.parse(
      serializePublicPenDocument([master("m1") as unknown as SceneNode, frame], [], "light"),
    );
    expect(json.children).toHaveLength(1);
    expect(json.children[0].children).toHaveLength(1);
  });

  it("duplicating a master yields a plain embed, not a second master", () => {
    const clone = cloneNodeWithNewId(master("m") as unknown as SceneNode) as EmbedNode;
    expect(clone.component).toBeUndefined();
    expect(clone.htmlContent).toContain('data-c="x"');
  });
});
