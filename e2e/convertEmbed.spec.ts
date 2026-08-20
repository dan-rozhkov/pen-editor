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
  await page.goto("/app");
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

test("a remote image without CORS does not blank the converted design", async ({ page }) => {
  const textureUploadErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "error" &&
      text.includes("texImage2D") &&
      text.includes("cross-origin")
    ) {
      textureUploadErrors.push(text);
    }
  });
  page.on("pageerror", (error) => {
    if (
      error.message.includes("texImage2D") &&
      error.message.includes("cross-origin")
    ) {
      textureUploadErrors.push(error.message);
    }
  });

  const remoteImageUrl = "https://no-cors.example/hero.png";
  await page.route(remoteImageUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      // Intentionally omit Access-Control-Allow-Origin. A plain DOM <img>
      // may display this response, but a CORS image request and WebGL upload
      // must reject it.
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl3bNwAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });

  await page.goto("/app");
  await page.waitForFunction(
    () => Boolean((window as unknown as { __sceneStore?: unknown }).__sceneStore),
  );

  const result = await page.evaluate(async ({ html, imageUrl }) => {
    const store = (
      window as unknown as { __sceneStore: { getState: () => SceneStoreState } }
    ).__sceneStore;
    store.getState().setNodes([
      {
        id: "e2e-no-cors-embed",
        type: "embed",
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        name: "No CORS Embed",
        htmlContent: html.replace("__IMAGE_URL__", imageUrl),
      },
    ]);
    const rootId = await store
      .getState()
      .convertEmbedToDesign("e2e-no-cors-embed");
    const state = store.getState();
    return {
      rootId,
      embedGone: !state.nodesById["e2e-no-cors-embed"],
      survivingText: Object.values(state.nodesById).some(
        (node) => node.type === "text" && node.text === "Native content survives",
      ),
    };
  }, {
    html: [
      '<div style="width:400px;height:300px;background:#123456">',
      '<div style="color:#ffffff;font-size:24px">Native content survives</div>',
      '<img src="__IMAGE_URL__" style="width:100px;height:100px">',
      "</div>",
    ].join(""),
    imageUrl: remoteImageUrl,
  });

  expect(result.rootId).not.toBeNull();
  expect(result.embedGone).toBe(true);
  expect(result.survivingText).toBe(true);

  // Let the async image-fill loader settle and Pixi render a frame. Before
  // the fix, the non-CORS fallback created a tainted texture and texImage2D
  // aborted the entire batch here.
  //
  // A fixed delay can't stand in for "the loader is done": the retry chain
  // in loadRasterTextureFromUrl (src/pixi/renderers/imageFillHelpers.ts) —
  // Assets.load(url) → <img crossOrigin> → /api/image-proxy retry — doesn't
  // deterministically reach every step in a real browser (e.g. Assets.load
  // can itself resolve or reject depending on how the browser's fetch
  // implementation treats the mocked cross-origin response, so the
  // `/api/image-proxy` leg this test used to wait on isn't reliably hit at
  // all: confirmed by instrumenting this spec, where the retry settled
  // without ever requesting the proxy). So instead of waiting on one
  // specific leg of the chain, wait on the mechanism-agnostic completion
  // signal every leg feeds into regardless of which path it took:
  // `waitForPendingImageFills` (src/pixi/renderers/pendingImageLoads.ts),
  // already used internally by get_screenshot/captureNodeScreenshot for the
  // same "has every in-flight image-fill texture load settled" question.
  // Exposed dev-only on window in main.tsx, matching the existing
  // __sceneStore-style e2e hooks. Then a couple of animation frames for Pixi
  // to pick up the result and attempt the texture upload.
  await page.evaluate(
    () =>
      (
        window as unknown as {
          __waitForPendingImageFills: (timeoutMs?: number) => Promise<void>;
        }
      ).__waitForPendingImageFills(5_000),
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(textureUploadErrors).toEqual([]);
});
