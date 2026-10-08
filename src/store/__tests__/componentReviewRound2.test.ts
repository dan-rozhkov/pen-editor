import { describe, it, expect, beforeEach, vi } from "vitest";
import type { EmbedComponentMeta, FlatSceneNode } from "@/types/scene";
import { usePageStore } from "@/store/pageStore";
import { useSceneStore } from "@/store/sceneStore";
import { removeMasterNode } from "@/store/componentOps";
import { selectComponentRegistry } from "@/store/componentRegistry";
import { catchUpStaleRegions, reconcileConsumers } from "@/store/componentSync";
import { activeHtml, embedNode, resetWorld, seedEmbed, seedInactivePage } from "@/test/componentFixtures";
import { BTN_HTML, makeRegistry } from "@/lib/embedComponents/__tests__/fixtures";
import { parseMaster, renderInstance, validateMaster, type ComponentMaster } from "@/lib/embedComponents";
import { assertDefined } from "@/test/assertions";
import { defineComponent } from "@/lib/tools/components";
import { parse } from "@/test/componentFixtures";

vi.mock("@/lib/embedComponents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/embedComponents")>();
  return { ...actual, validateMaster: vi.fn(actual.validateMaster) };
});

const meta = (key: string): EmbedComponentMeta => ({ key, name: key });

function masterOf(key: string, html: string): ComponentMaster {
  const found = makeRegistry({ [key]: html }).get(key);
  assertDefined(found);
  return found;
}

/** Seed a master node (normalized html) on the active page. */
function seedMaster(id: string, master: ComponentMaster): void {
  seedEmbed(id, master.html, { component: meta(master.key) });
}

beforeEach(() => {
  resetWorld();
  vi.mocked(validateMaster).mockClear();
});

describe("a component defined later fixes raw <c-x> tags written earlier", () => {
  it("reports the unknown tag, then expands it in the master and in a consumer once x exists", async () => {
    seedEmbed("s1", "<main><c-x>hi</c-x></main>");
    const first = parse(
      await defineComponent({ key: "card", name: "Card", html: `<section data-c="card"><c-x></c-x></section>` }),
    );
    expect(first.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Unknown component tag.*<c-x>/)]));

    await defineComponent({ key: "x", name: "X", html: `<i data-c="x"><b data-c-slot="body">-</b></i>` });
    expect(activeHtml("s1")).toContain('data-c="x"');
    const card = selectComponentRegistry().get("card");
    assertDefined(card);
    expect(card.html).toContain('data-c="x"');
    expect(card.html).not.toContain("<c-x");
  });
});

describe("define-time cycle detection counts raw <c-KEY> tags", () => {
  it("refuses c containing a when a holds a raw <c-b> and b holds a raw <c-c>", async () => {
    await defineComponent({ key: "a", name: "A", html: `<i data-c="a"><c-b></c-b></i>` });
    await defineComponent({ key: "b", name: "B", html: `<i data-c="b"><c-c></c-c></i>` });
    const result = parse(await defineComponent({ key: "c", name: "C", html: `<i data-c="c"><c-a></c-a></i>` }));
    expect(result.error).toMatch(/dependency cycle|cannot contain itself/);
    expect(selectComponentRegistry().has("c")).toBe(false);
  });
});

describe("removeMasterNode on an inactive page", () => {
  it("detaches a master nested in a frame from its parent and drops its child list", () => {
    seedInactivePage("p2", "Components", { placeholder: "<p/>" });
    const frame = { ...embedNode("f", ""), type: "frame" } as unknown as FlatSceneNode;
    const master = embedNode("m", masterOf("btn", BTN_HTML).html, { component: meta("btn") });
    usePageStore.setState((s) => ({
      pages: s.pages.map((p) =>
        p.id === "p2"
          ? {
              ...p,
              nodesById: { f: frame, m: master },
              parentById: { f: null, m: "f" },
              childrenById: { f: ["m"], m: [] },
              rootIds: ["f"],
            }
          : p,
      ),
    }));

    expect(removeMasterNode("btn")).toBe(true);
    const page = usePageStore.getState().pages.find((p) => p.id === "p2");
    assertDefined(page);
    expect(page.nodesById).not.toHaveProperty("m");
    expect(page.parentById).not.toHaveProperty("m");
    expect(page.childrenById).not.toHaveProperty("m");
    expect(page.childrenById.f).toEqual([]);
    expect(page.nodesById).toHaveProperty("f");
  });
});

describe("a shadowed duplicate master keeps its own root", () => {
  it("refreshes its nested regions but is not re-rendered from the winning master", () => {
    const inner = masterOf("btn", BTN_HTML);
    const staleInner = renderInstance(inner);
    const innerV2 = masterOf("btn", BTN_HTML.replace("var(--space-2)", "var(--space-9)"));
    const winner = masterOf("dup", `<div data-c="dup">WINNER</div>`);
    const shadow = masterOf("dup", `<div data-c="dup">SHADOW ${staleInner}</div>`);
    seedMaster("btn", innerV2);
    seedMaster("w", winner);
    seedMaster("s", shadow);

    reconcileConsumers({ keys: ["btn"] });
    const html = activeHtml("s");
    expect(html).toContain("SHADOW");
    expect(html).not.toContain("WINNER");
    expect(html).toContain(`data-c-rev="${parseMaster(innerV2)?.rev}"`);
  });
});

describe("catch-up refreshes stale masters too", () => {
  it("re-renders a nested region inside a master whose inner master changed unnoticed", () => {
    const v1 = masterOf("btn", BTN_HTML);
    const v2 = masterOf("btn", BTN_HTML.replace("var(--space-2)", "var(--space-9)"));
    const card = masterOf("card", `<section data-c="card">${renderInstance(v1)}</section>`);
    seedMaster("btn", v2);
    seedMaster("card", card);

    expect(catchUpStaleRegions()).toBeGreaterThan(0);
    expect(activeHtml("card")).toContain(`data-c-rev="${parseMaster(v2)?.rev}"`);
  });
});

describe("master refresh passes", () => {
  /** m0 <- m1 <- ... : each master wraps one instance of the previous one. */
  function seedChain(length: number): void {
    const all = new Map<string, ComponentMaster>();
    for (let i = 0; i < length; i++) {
      const key = `m${i}`;
      const prev = all.get(`m${i - 1}`);
      const html = prev ? `<div data-c="${key}">${renderInstance(prev)}</div>` : `<div data-c="${key}">${BTN_HTML}</div>`;
      all.set(key, masterOf(key, i === 0 ? `<div data-c="${key}">leaf</div>` : html));
    }
    for (const [key, master] of all) seedMaster(key, master);
  }
  const touchLeaf = () =>
    useSceneStore.getState().updateNode("m0", { htmlContent: masterOf("m0", `<div data-c="m0">changed</div>`).html } as never);

  it("re-plans a master only when a key it mentions changed in the previous pass", () => {
    seedChain(4);
    const leaf = masterOf("m0", `<div data-c="m0">leaf</div>`);
    // A second consumer of m0 that nothing else mentions: planned in the first pass only.
    seedMaster("side", masterOf("side", `<div data-c="side">${renderInstance(leaf)}</div>`));
    touchLeaf();
    vi.mocked(validateMaster).mockClear();

    reconcileConsumers({ keys: ["m0"] });
    const planned = (key: string) => vi.mocked(validateMaster).mock.calls.filter((c) => c[1] === key).length;
    expect(planned("side")).toBe(1);
  });

  it("warns when the dependency chain is deeper than the pass cap", () => {
    seedChain(16);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    touchLeaf();
    reconcileConsumers({ keys: ["m0"] });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/dependency chain/i));
    warn.mockRestore();
  });
});
