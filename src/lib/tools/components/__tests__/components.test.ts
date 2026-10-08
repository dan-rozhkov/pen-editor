import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { usePageStore } from "@/store/pageStore";
import { selectComponentRegistry, COMPONENTS_PAGE_NAME } from "@/store/componentRegistry";
import {
  activeHtml,
  flushMicrotasks,
  pageHtml,
  parse,
  resetWorld,
  seedEmbed,
  seedInactivePage,
} from "@/test/componentFixtures";
import { BTN_HTML } from "@/lib/embedComponents/__tests__/fixtures";
import { installComponentSync } from "@/store/componentSync";
import { editEmbedHtml } from "../../editEmbedHtml";
import { defineComponent, deleteComponent, detachInstance, extractComponent } from "..";

const BTN_ARGS = {
  key: "btn",
  name: "Button",
  html: BTN_HTML,
  variants: { kind: ["primary", "secondary"] },
};

async function define(extra: Record<string, unknown> = {}) {
  return parse(await defineComponent({ ...BTN_ARGS, ...extra }));
}

describe("define_component", () => {
  beforeEach(() => resetWorld());

  it("creates the Components page in the background and the master on it", async () => {
    seedEmbed("s1", "<p>screen</p>");
    const result = await define();
    expect(result.error).toBeUndefined();
    expect(result.created).toBe(true);
    expect(result.slots).toEqual(["label"]);
    expect(result.variants).toEqual({ kind: ["primary", "secondary"] });

    const { pages, activePageId } = usePageStore.getState();
    expect(activePageId).toBe("p1");
    const page = pages.find((p) => p.name === COMPONENTS_PAGE_NAME);
    expect(page?.rootIds).toHaveLength(1);
    expect(selectComponentRegistry().get("btn")?.meta.name).toBe("Button");
  });

  it("creates the master on the active page when that is the Components page", async () => {
    usePageStore.setState((s) => ({
      pages: s.pages.map((p) => (p.id === "p1" ? { ...p, name: COMPONENTS_PAGE_NAME } : p)),
    }));
    await define();
    const nodes = Object.values(useSceneStore.getState().nodesById);
    expect(nodes).toHaveLength(1);
    expect(useHistoryStore.getState().past).toHaveLength(1);
    // Update goes through the scene store too: one more undo step.
    await define({ name: "Button v2" });
    expect(Object.values(useSceneStore.getState().nodesById)).toHaveLength(1);
    expect(useHistoryStore.getState().past).toHaveLength(2);
  });

  it("updates an existing master in place and keeps unrelated meta", async () => {
    await define({ description: "Primary action" });
    const second = await define({ name: "Button 2" });
    expect(second.created).toBe(false);
    const master = selectComponentRegistry().get("btn");
    expect(master?.meta.name).toBe("Button 2");
    expect(master?.meta.description).toBe("Primary action");
    expect(Object.values(usePageStore.getState().pages.find((p) => p.name === COMPONENTS_PAGE_NAME)!.nodesById)).toHaveLength(1);
  });

  it("re-renders instances on every page when the master changes", async () => {
    await define();
    seedEmbed("s1", "<main></main>");
    seedInactivePage("p2", "Other", { s2: "<main></main>" });
    await editEmbedHtml({
      nodeId: "s1",
      edits: [{ oldString: "<main></main>", newString: `<main><c-btn kind="secondary">Cancel</c-btn></main>` }],
    });
    expect(activeHtml("s1")).toContain('data-v-kind="secondary"');
    // Put an equivalent region on the other page by hand, as a saved document would hold it.
    const region = activeHtml("s1");
    usePageStore.setState((s) => ({
      pages: s.pages.map((p) =>
        p.id === "p2"
          ? { ...p, nodesById: { ...p.nodesById, s2: { ...p.nodesById.s2, htmlContent: region } as never } }
          : p,
      ),
    }));

    const changed = BTN_HTML.replace("<button", '<button class="v2"');
    const result = await define({ html: changed });
    expect(result.updatedEmbeds).toBe(2);
    for (const html of [activeHtml("s1"), pageHtml("p2", "s2")]) {
      expect(html).toContain('class="v2"');
      expect(html).toContain(">Cancel<");
    }
  });

  it.each([
    ["bad key", { key: "Bad Key" }, /Invalid key/],
    ["reserved key", { key: "slot" }, /Invalid key/],
    ["missing name", { name: "" }, /name is required/],
    ["missing html", { html: "" }, /html is required/],
    ["two roots", { html: "<div></div><div></div>" }, /exactly one root/],
    ["bad variants", { variants: { kind: [] } }, /variants must be/],
    ["bad status", { status: "weird" }, /status must be/],
  ])("rejects %s", async (_name, extra, message) => {
    const result = await define(extra);
    expect(result.error).toMatch(message);
  });

  it("refuses a dependency cycle", async () => {
    await defineComponent({ key: "a", name: "A", html: `<div data-c="a"></div>` });
    await defineComponent({ key: "b", name: "B", html: `<div data-c="b"><span data-c="a"></span></div>` });
    const cyc = parse(
      await defineComponent({ key: "a", name: "A", html: `<div data-c="a"><span data-c="b"></span></div>` }),
    );
    expect(String(cyc.error)).toMatch(/dependency cycle: a -> b -> a/);
  });
});

describe("edit_embed_html with components", () => {
  beforeEach(async () => {
    resetWorld();
    await define();
    seedEmbed("s1", "<main><p>x</p></main>");
    await editEmbedHtml({
      nodeId: "s1",
      edits: [{ oldString: "<p>x</p>", newString: `<c-btn kind="secondary">Cancel</c-btn>` }],
    });
  });

  it("expands registered tags and reports unknown ones", async () => {
    const result = parse(
      await editEmbedHtml({
        nodeId: "s1",
        edits: [{ oldString: "</main>", newString: "<c-ghost>boo</c-ghost></main>" }],
      }),
    );
    expect(result.error).toBeUndefined();
    expect(JSON.stringify(result.issues)).toMatch(/<c-ghost>/);
    expect(activeHtml("s1")).toContain("<c-ghost>boo</c-ghost>");
  });

  it("allows a slot edit but refuses a managed-zone edit with the spec message", async () => {
    const ok = parse(
      await editEmbedHtml({ nodeId: "s1", edits: [{ oldString: ">Cancel<", newString: ">Back<" }] }),
    );
    expect(ok.error).toBeUndefined();
    expect(activeHtml("s1")).toContain(">Back<");

    const before = activeHtml("s1");
    const refused = parse(
      await editEmbedHtml({
        nodeId: "s1",
        edits: [{ oldString: "<span data-c-slot", newString: "<b>!</b><span data-c-slot" }],
      }),
    );
    expect(refused.error).toBe("region `btn` is component-managed; edit the master or detach it");
    expect(activeHtml("s1")).toBe(before);
  });
});

describe("detach_instance / delete_component", () => {
  beforeEach(async () => {
    resetWorld();
    await define();
    seedEmbed("s1", "<main></main>");
    await editEmbedHtml({
      nodeId: "s1",
      edits: [
        {
          oldString: "<main></main>",
          newString: `<main><c-btn kind="secondary">One</c-btn><c-btn kind="primary">Two</c-btn></main>`,
        },
      ],
    });
  });

  it("detaches one region and keeps the others managed", async () => {
    const result = parse(await detachInstance({ nodeId: "s1", selector: "button" }));
    expect(result.detached).toBe(1);
    const html = activeHtml("s1");
    expect(html.match(/<button data-c="btn"/g)).toHaveLength(1);
    expect(html).toContain('data-d="btn-1"');
    expect(html).toContain(">One<");
    // The managed block stays with the remaining instance, the detached one keeps its own copy.
    expect(html).toContain('data-c-style="btn"');
    expect(html).toContain('data-d-style="btn-1"');
  });

  it("errors when the selector hits no instance, or the node is not an embed", async () => {
    expect(parse(await detachInstance({ nodeId: "s1", selector: "main" })).error).toMatch(/No component instance/);
    expect(parse(await detachInstance({ nodeId: "nope", selector: "x" })).error).toMatch(/not found/);
  });

  it("delete_component detaches every instance on every page, then removes the master", async () => {
    const region = activeHtml("s1");
    seedInactivePage("p2", "Other", { s2: region });
    const result = parse(await deleteComponent({ key: "btn" }));
    expect(result.detachedInstances).toBe(4);
    expect(result.embedsUpdated).toBe(2);
    for (const html of [activeHtml("s1"), pageHtml("p2", "s2")]) {
      expect(html).not.toContain("data-c=");
      expect(html).not.toContain("data-c-style");
      expect(html).toContain(">One<");
      expect(html).toContain("<style data-d-style=");
    }
    expect(selectComponentRegistry().has("btn")).toBe(false);
    const comps = usePageStore.getState().pages.find((p) => p.name === COMPONENTS_PAGE_NAME)!;
    expect(comps.rootIds).toHaveLength(0);
  });

  it("delete_component on an unknown key errors", async () => {
    expect(parse(await deleteComponent({ key: "nope" })).error).toMatch(/not found/);
  });
});

describe("extract_component", () => {
  const SCREEN = `<style>.cta { padding: 8px; background: red } .other { color: blue }</style>
<main><button class="cta" id="buy">Buy now</button><p>text</p><button class="cta">Learn more</button></main>`;

  beforeEach(() => {
    resetWorld();
    seedEmbed("s1", SCREEN);
  });

  it("promotes an element to a master with its CSS and a slot, and replaces it", async () => {
    const result = parse(await extractComponent({ nodeId: "s1", selector: "#buy", key: "cta", name: "CTA" }));
    expect(result.error).toBeUndefined();
    expect(result.replaced).toBe(1);
    expect(result.slots).toEqual(["text"]);

    const html = activeHtml("s1");
    expect(html).toContain('<button class="cta" data-c="cta"');
    expect(html).toContain('id="buy"');
    expect(html).toContain(">Buy now<");
    expect(html).toContain('<style data-c-style="cta">');
    // The second button is untouched without replaceSimilar.
    expect(html).toContain('<button class="cta">Learn more</button>');

    const master = selectComponentRegistry().get("cta")!;
    expect(master.html).toContain('[data-c="cta"].cta');
    expect(master.html).not.toContain(".other");
  });

  it("replaceSimilar swaps structurally equal elements on every page, keeping their text", async () => {
    seedInactivePage("p2", "Other", { s2: `<div><button class="cta">Sign up</button></div>` });
    const result = parse(
      await extractComponent({ nodeId: "s1", selector: "#buy", key: "cta", name: "CTA", replaceSimilar: true }),
    );
    expect(result.replaced).toBe(3);
    expect(activeHtml("s1")).toContain(">Learn more<");
    expect(activeHtml("s1").match(/<button class="cta" data-c="cta"/g)).toHaveLength(2);
    expect(pageHtml("p2", "s2")).toContain('<button class="cta" data-c="cta"');
    expect(pageHtml("p2", "s2")).toContain(">Sign up<");
  });

  it("is one undo step on the active page", async () => {
    await extractComponent({ nodeId: "s1", selector: "#buy", key: "cta", name: "CTA", replaceSimilar: true });
    expect(useHistoryStore.getState().past).toHaveLength(1);
  });

  it.each([
    ["missing selector match", { selector: ".nope" }, /matched nothing/],
    ["bad key", { key: "No Good" }, /Invalid key/],
    ["unknown node", { nodeId: "zzz" }, /not found/],
  ])("errors on %s", async (_n, extra, message) => {
    const result = parse(
      await extractComponent({ nodeId: "s1", selector: "#buy", key: "cta", name: "CTA", ...extra }),
    );
    expect(result.error).toMatch(message);
  });

  it("refuses to re-extract an existing key or an element already in an instance", async () => {
    await extractComponent({ nodeId: "s1", selector: "#buy", key: "cta", name: "CTA" });
    const again = parse(await extractComponent({ nodeId: "s1", selector: "button", key: "cta", name: "CTA" }));
    expect(again.error).toMatch(/already exists/);
    const nested = parse(await extractComponent({ nodeId: "s1", selector: "#buy", key: "cta2", name: "CTA2" }));
    expect(nested.error).toMatch(/already part of a component instance/);
  });
});

describe("component sync subscriber", () => {
  let stop: () => void;
  beforeEach(() => {
    resetWorld();
    stop = installComponentSync();
    return () => stop();
  });

  it("re-renders consumers when the master node is edited directly, and on undo", async () => {
    usePageStore.setState((s) => ({
      pages: s.pages.map((p) => (p.id === "p1" ? { ...p, name: COMPONENTS_PAGE_NAME } : p)),
    }));
    await define();
    seedEmbed("s1", "<main></main>");
    await editEmbedHtml({
      nodeId: "s1",
      edits: [{ oldString: "<main></main>", newString: `<main><c-btn>Go</c-btn></main>` }],
    });
    const masterId = Object.values(useSceneStore.getState().nodesById).find(
      (n) => (n as { component?: unknown }).component,
    )!.id;
    const before = activeHtml("s1");

    useSceneStore.getState().updateNode(masterId, {
      htmlContent: (useSceneStore.getState().nodesById[masterId] as unknown as { htmlContent: string }).htmlContent.replace(
        "<button",
        '<button class="v3"',
      ),
    } as never);
    await flushMicrotasks();
    expect(activeHtml("s1")).toContain('class="v3"');
    expect(activeHtml("s1")).toContain(">Go<");

    // Undo restores the master AND its consumer together (same step).
    const past = useHistoryStore.getState().past;
    const snapshot = past[past.length - 1];
    useSceneStore.getState().restoreSnapshot(snapshot);
    await flushMicrotasks();
    expect(activeHtml("s1")).toBe(before);
  });

  it("catches a stale region up when its embed changes (e.g. restored by undo)", async () => {
    await define();
    seedEmbed("s1", "<main></main>");
    await editEmbedHtml({
      nodeId: "s1",
      edits: [{ oldString: "<main></main>", newString: `<main><c-btn>Go</c-btn></main>` }],
    });
    const fresh = activeHtml("s1");
    const stale = fresh.replace(/data-c-rev="[0-9a-f]+"/, 'data-c-rev="00000000"');
    useSceneStore.getState().updateNode("s1", { htmlContent: stale } as never);
    await flushMicrotasks();
    expect(activeHtml("s1")).toBe(fresh);
  });

  it("catches inactive-page consumers up on page activation", async () => {
    await define();
    seedEmbed("s1", "<main></main>");
    await editEmbedHtml({
      nodeId: "s1",
      edits: [{ oldString: "<main></main>", newString: `<main><c-btn>Go</c-btn></main>` }],
    });
    const stale = activeHtml("s1").replace(/data-c-rev="[0-9a-f]+"/, 'data-c-rev="00000000"');
    seedInactivePage("p3", "Third", { s3: stale });
    usePageStore.getState().switchToPage("p3");
    await flushMicrotasks();
    expect(activeHtml("s3")).toContain(`data-c-rev="${(await masterRev())}"`);
  });
});

async function masterRev(): Promise<string> {
  const { computeRev } = await import("@/lib/embedComponents");
  return computeRev(selectComponentRegistry().get("btn")!);
}
