import { test, expect } from "@playwright/test";

// Real-browser smoke test for the embed → design conversion pipeline
// (convertEmbedToDesign): installs the vendored h2d capture bundle inside an
// iframe, captures the embed's HTML, and converts the capture into scene
// nodes. Unit tests mock this path; here it runs for real in chromium.
// /api/chat and /api/models stubs are irrelevant — this spec never opens the
// chat panel.

const EMBED_HTML = [
  '<div style="width:400px;height:300px;background:#f5f0e6;font-family:Plus Jakarta Sans,sans-serif">',
  '<div style="font-family:JetBrains Mono,monospace;font-size:16px">10,1</div>',
  '<div style="font-size:16px">Inherited line height</div>',
  '<div style="width:28px;height:28px;background:#0f766e;border-radius:50%"></div>',
  '<div style="width:80px;height:60px;background:linear-gradient(180deg,#fde68a 0%,#fbbf24 100%)"></div>',
  '<div style="width:80px;height:40px;background:repeating-linear-gradient(45deg,#fef3c7 0,#fde68a 16px)"></div>',
  "</div>",
].join("");

interface SceneNode {
  id?: string;
  type?: string;
  name?: string;
  text?: string;
  fontFamily?: string;
  fontFallback?: string;
  gradientFill?: unknown;
  [key: string]: unknown;
}

interface SceneStoreState {
  setNodes: (nodes: SceneNode[]) => void;
  convertEmbedToDesign: (id: string) => Promise<string | null>;
  nodesById: Record<string, SceneNode>;
}

test("convert embed to design via h2d capture", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => Boolean((window as unknown as { __sceneStore?: unknown }).__sceneStore)
  );

  const result = await page.evaluate(async (html) => {
    const store = (
      window as unknown as { __sceneStore: { getState: () => SceneStoreState } }
    ).__sceneStore;
    store.getState().setNodes([
      {
        id: "e2e-embed",
        type: "embed",
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        name: "E2E Embed",
        htmlContent: html,
      },
    ]);
    const rootId = await store.getState().convertEmbedToDesign("e2e-embed");
    const s = store.getState();
    const nodes = Object.values(s.nodesById);
    return {
      rootId,
      rootType: rootId ? s.nodesById[rootId]?.type : null,
      rootName: rootId ? s.nodesById[rootId]?.name : null,
      embedGone: !s.nodesById["e2e-embed"],
      gradientCount: nodes.filter((n) => n.gradientFill).length,
      monoText: nodes.find((n) => n.type === "text" && n.text === "10,1"),
      inheritedText: nodes.find(
        (n) => n.type === "text" && n.text === "Inherited line height"
      ),
      roundMarker: nodes.find(
        (n) => n.type === "frame" && n.width === 28 && n.height === 28
      ),
    };
  }, EMBED_HTML);

  expect(result.rootId).not.toBeNull();
  expect(result.rootType).toBe("frame");
  expect(result.rootName).toBe("E2E Embed");
  expect(result.embedGone).toBe(true);
  // plain gradient bar + repeating-gradient bar (Task 3) both survive
  expect(result.gradientCount).toBeGreaterThanOrEqual(2);
  expect(result.monoText?.fontFamily).toBe("JetBrains Mono");
  expect(result.monoText?.fontFallback).toBe("monospace");
  expect(result.inheritedText?.lineHeight).toBe(1.5);
  expect(result.roundMarker?.cornerRadius).toBe(14);
});
