import { beforeEach, describe, expect, it } from "vitest";
import { resetStores } from "@/test/fixtures";
import { useVariableStore } from "@/store/variableStore";
import { useHistoryStore } from "@/store/historyStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { usePageStore } from "@/store/pageStore";
import type { FlatSceneNode } from "@/types/scene";

const embed = (id: string, html: string) =>
  ({ id, type: "embed", x: 0, y: 0, width: 100, height: 100, htmlContent: html }) as unknown as FlatSceneNode;

const html = (id: string) => {
  const live = useSceneStore.getState().nodesById[id] as unknown as { htmlContent: string } | undefined;
  return live?.htmlContent;
};
const pageHtml = (pageId: string, id: string) =>
  (usePageStore.getState().pages.find((p) => p.id === pageId)?.nodesById[id] as unknown as { htmlContent: string })
    .htmlContent;

function undo() {
  const prev = useHistoryStore.getState().undo(createSnapshot(useSceneStore.getState()));
  if (prev) useSceneStore.getState().restoreSnapshot(prev);
}

let otherPageId: string;

beforeEach(() => {
  resetStores();
  const activeId = usePageStore.getState().activePageId;
  otherPageId = "page-b";
  const base = usePageStore.getState().pages[0];
  usePageStore.setState({
    activePageId: activeId,
    pages: [
      base,
      {
        ...base,
        id: otherPageId,
        name: "B",
        nodesById: { e2: embed("e2", "<p style='color:var(--brand)'>x</p>") },
        parentById: { e2: null },
        childrenById: {},
        rootIds: ["e2"],
      },
    ],
  });
  useSceneStore.setState({
    nodesById: {
      e1: embed("e1", "<p style='color:var(--brand); margin:var(--brand-2)'>x</p>"),
      e3: embed("e3", "<p>no refs</p>"),
    },
    parentById: { e1: null, e3: null },
    childrenById: {},
    rootIds: ["e1", "e3"],
  });
  useVariableStore.getState().addVariable({ id: "v1", name: "--brand", type: "color", value: "#111111" });
  useVariableStore.getState().addVariable({ id: "v2", name: "--taken", type: "color", value: "#222222" });
  useHistoryStore.setState({ past: [], future: [] });
});

describe("renameVariable", () => {
  it("rewrites embeds on the active and on other pages", () => {
    expect(useVariableStore.getState().renameVariable("v1", "--accent")).toEqual({ ok: true });
    expect(html("e1")).toBe("<p style='color:var(--accent); margin:var(--brand-2)'>x</p>");
    expect(pageHtml(otherPageId, "e2")).toBe("<p style='color:var(--accent)'>x</p>");
  });

  it("slugifies non-prefixed names for the rewrite", () => {
    useVariableStore.getState().addVariable({ id: "v3", name: "Primary Color", type: "color", value: "#333333" });
    useSceneStore.setState((s) => ({
      nodesById: { ...s.nodesById, e1: embed("e1", "var(--primary-color)") },
    }));
    useVariableStore.getState().renameVariable("v3", "Main Color");
    expect(html("e1")).toBe("var(--main-color)");
  });

  it("is one undo step for the active page; undo reconciles the other pages", () => {
    useVariableStore.getState().renameVariable("v1", "--accent");
    expect(useHistoryStore.getState().past).toHaveLength(1);
    undo();
    expect(useVariableStore.getState().variables.find((v) => v.id === "v1")?.name).toBe("--brand");
    expect(html("e1")).toContain("var(--brand)");
    // Documented decision: the snapshot is active-page only, so restoreSnapshot
    // carries the CSS-name flip over to the other pages.
    expect(pageHtml(otherPageId, "e2")).toBe("<p style='color:var(--brand)'>x</p>");
  });

  it("rejects a CSS-name collision and changes nothing", () => {
    const before = useSceneStore.getState().nodesById;
    const res = useVariableStore.getState().renameVariable("v1", "--taken");
    expect(res).toHaveProperty("error");
    expect(useVariableStore.getState().variables.find((v) => v.id === "v1")?.name).toBe("--brand");
    expect(useSceneStore.getState().nodesById).toBe(before);
    expect(useHistoryStore.getState().past).toHaveLength(0);
  });

  it("rejects an unknown id", () => {
    expect(useVariableStore.getState().renameVariable("nope", "x")).toHaveProperty("error");
  });

  it("leaves HTML untouched (same node references) when the slug does not change", () => {
    useVariableStore.getState().addVariable({ id: "v3", name: "Color 1", type: "color", value: "#333333" });
    const before = useSceneStore.getState().nodesById;
    const pagesBefore = usePageStore.getState().pages;
    expect(useVariableStore.getState().renameVariable("v3", "color  1")).toEqual({ ok: true });
    expect(useSceneStore.getState().nodesById.e1).toBe(before.e1);
    expect(usePageStore.getState().pages).toBe(pagesBefore);
  });

  it("updateVariable({ name }) takes the same path", () => {
    expect(useVariableStore.getState().updateVariable("v1", { name: "--accent" })).toBe(true);
    expect(html("e1")).toContain("var(--accent)");
    expect(useVariableStore.getState().updateVariable("v1", { name: "--taken" })).toBe(false);
  });
});
