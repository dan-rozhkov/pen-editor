import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSceneStore } from "@/store/sceneStore";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

// PixiJS must never be initialized in unit tests — mock the rasterizers to
// return fake canvases of the right pixel size instead of touching WebGL.
const renderNodeToCanvasMock = vi.fn();
vi.mock("@/utils/exportUtils", () => ({
  renderNodeToCanvas: (...args: unknown[]) => renderNodeToCanvasMock(...args),
}));

const captureEmbedCanvasMock = vi.fn();
vi.mock("@/lib/embedScreenshot", () => ({
  captureEmbedCanvas: (...args: unknown[]) => captureEmbedCanvasMock(...args),
}));

// isOffline reads navigator.onLine; toggle it per-test via this mock, same
// idiom as retryFetch.test.ts.
let offlineFlag = false;
vi.mock("@/lib/apiBase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apiBase")>();
  return { ...actual, isOffline: () => offlineFlag };
});

import { publishToShowcase } from "@/lib/tools/publishToShowcase";

const MOBILE = { width: 390, height: 844 };
const RASTER = { width: MOBILE.width * 2, height: MOBILE.height * 2 };

function fakeCanvas(width: number, height: number, dataUrl = "data:image/png;base64,AAAA") {
  return {
    width,
    height,
    toDataURL: vi.fn(() => dataUrl),
  } as unknown as HTMLCanvasElement;
}

function seedEmbedNode(id: string, name: string, htmlContent: string, width = MOBILE.width, height = MOBILE.height) {
  const node = {
    id,
    type: "embed",
    name,
    x: 0,
    y: 0,
    width,
    height,
    htmlContent,
  } as unknown as FlatSceneNode;
  const state = useSceneStore.getState();
  useSceneStore.setState({
    nodesById: { ...state.nodesById, [id]: node },
    parentById: { ...state.parentById, [id]: null },
    rootIds: [...state.rootIds, id],
    _cachedTree: null,
  });
}

function seedFrameNode(id: string, name: string, width = MOBILE.width, height = MOBILE.height) {
  const node = {
    id,
    type: "frame",
    name,
    x: 0,
    y: 0,
    width,
    height,
    fill: "#ffffff",
    layout: { autoLayout: false, gap: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 },
  } as unknown as FlatSceneNode;
  const state = useSceneStore.getState();
  useSceneStore.setState({
    nodesById: { ...state.nodesById, [id]: node },
    parentById: { ...state.parentById, [id]: null },
    childrenById: { ...state.childrenById, [id]: [] },
    rootIds: [...state.rootIds, id],
    _cachedTree: null,
  });
}

describe("publish_to_showcase", () => {
  beforeEach(() => {
    resetStores();
    renderNodeToCanvasMock.mockReset();
    captureEmbedCanvasMock.mockReset();
    useCanvasRefStore.setState({ pixiRefs: {} as never });
    global.fetch = vi.fn();
    offlineFlag = false;
  });

  it("posts the expected body shape and returns the runId on the happy path", async () => {
    seedEmbedNode("embed1", "Home", "<html><body>Home</body></html>");
    seedEmbedNode("embed2", "Settings", "<html><body>Settings</body></html>");
    captureEmbedCanvasMock.mockResolvedValue(fakeCanvas(RASTER.width, RASTER.height));

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        runId: "run-123",
        platform: "mobile",
        screens: [
          { title: "Home", imageUrl: "https://example.com/home.png" },
          { title: "Settings", imageUrl: "https://example.com/settings.png" },
        ],
      }),
    });

    const result = JSON.parse(
      await publishToShowcase({
        theme: "My App",
        platform: "mobile",
        screens: [
          { nodeId: "embed1", title: "Home", cover: true },
          { nodeId: "embed2", title: "Settings" },
        ],
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/showcase/publish");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.theme).toBe("My App");
    expect(body.platform).toBe("mobile");
    expect(body.coverIndex).toBe(1);
    expect(body.screens).toHaveLength(2);
    expect(body.screens[0]).toMatchObject({
      name: "Home",
      width: MOBILE.width,
      height: MOBILE.height,
    });
    expect(body.screens[0].image).toMatch(/^data:image\/png;base64,/);
    // Backend rejects a publish with no userId (400) — see showcasePublish.ts.
    expect(typeof body.userId).toBe("string");

    expect(result.published).toBe(2);
    expect(result.runId).toBe("run-123");
    expect(result.theme).toBe("My App");
  });

  it("always posts a userId matching the shape the backend accepts (dashed UUID or 32-hex)", async () => {
    // Not stubbing getUserId here deliberately: the backend's isPlausibleUserId
    // regex is the actual contract (POST /api/showcase/publish 400s on a
    // shape-invalid id), so assert against the real value userId.ts produces
    // rather than a mocked constant.
    seedEmbedNode("embed1", "Home", "<html></html>");
    captureEmbedCanvasMock.mockResolvedValue(fakeCanvas(RASTER.width, RASTER.height));
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ runId: "run-1", platform: "mobile", screens: [{ title: "Home", imageUrl: "x" }] }),
    });

    await publishToShowcase({ theme: "App", screens: [{ nodeId: "embed1", title: "Home" }] });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const DASHED_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const RAW_HEX_RE = /^[0-9a-f]{32}$/i;
    expect(DASHED_UUID_RE.test(body.userId) || RAW_HEX_RE.test(body.userId)).toBe(true);
  });

  it("uses an embed node's htmlContent verbatim", async () => {
    seedEmbedNode("embed1", "Home", "<html><body>Verbatim content</body></html>");
    captureEmbedCanvasMock.mockResolvedValue(fakeCanvas(RASTER.width, RASTER.height));
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ runId: "run-1", platform: "mobile", screens: [{ title: "Home", imageUrl: "x" }] }),
    });

    await publishToShowcase({
      theme: "App",
      screens: [{ nodeId: "embed1", title: "Home" }],
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.screens[0].htmlContent).toBe("<html><body>Verbatim content</body></html>");
  });

  it("wraps a non-embed frame's fragment into a full document", async () => {
    seedFrameNode("frame1", "Home");
    renderNodeToCanvasMock.mockResolvedValue(fakeCanvas(RASTER.width, RASTER.height));
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ runId: "run-1", platform: "mobile", screens: [{ title: "Home", imageUrl: "x" }] }),
    });

    await publishToShowcase({
      theme: "App",
      screens: [{ nodeId: "frame1", title: "Home" }],
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.screens[0].htmlContent).toContain("<!doctype html>");
    expect(body.screens[0].htmlContent).toContain("<body>");
  });

  it("normalizes a non-standard mobile screen without changing the scene node", async () => {
    seedEmbedNode("embed1", "Product Listing", "<html><body>Listing</body></html>", 375, 812);
    captureEmbedCanvasMock.mockResolvedValue(fakeCanvas(RASTER.width, RASTER.height));
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        runId: "run-normalized",
        platform: "mobile",
        screens: [{ title: "Product Listing", imageUrl: "x" }],
      }),
    });

    const result = JSON.parse(
      await publishToShowcase({
        theme: "App",
        platform: "mobile",
        screens: [{ nodeId: "embed1", title: "Product Listing" }],
      }),
    );

    expect(result.published).toBe(1);
    expect(captureEmbedCanvasMock).toHaveBeenCalledWith(
      expect.objectContaining({ width: 375, height: 812 }),
      2,
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.screens[0]).toMatchObject({ width: 390, height: 844 });
    expect(body.screens[0].htmlContent).toContain("data-pen-showcase-viewport");
    expect(useSceneStore.getState().nodesById.embed1).toMatchObject({ width: 375, height: 812 });
  });

  it("rejects more than 5 screens", async () => {
    const screens = Array.from({ length: 6 }, (_, i) => ({ nodeId: `embed${i}`, title: `Screen ${i}` }));
    const result = JSON.parse(await publishToShowcase({ theme: "App", screens }));
    expect(result.error).toContain("5");
  });

  it("rejects an unknown nodeId", async () => {
    const result = JSON.parse(
      await publishToShowcase({ theme: "App", screens: [{ nodeId: "nope", title: "Home" }] }),
    );
    expect(result.error).toContain("nope");
  });

  it("surfaces a throwing rasterizer as an error without calling fetch", async () => {
    seedEmbedNode("embed1", "Home", "<html></html>");
    captureEmbedCanvasMock.mockRejectedValue(new Error("boom"));
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    const result = JSON.parse(
      await publishToShowcase({ theme: "App", screens: [{ nodeId: "embed1", title: "Home" }] }),
    );

    expect(result.error).toContain("boom");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the server's error text on a 400", async () => {
    seedEmbedNode("embed1", "Home", "<html></html>");
    captureEmbedCanvasMock.mockResolvedValue(fakeCanvas(RASTER.width, RASTER.height));
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "theme is required" }),
    });

    const result = JSON.parse(
      await publishToShowcase({ theme: "App", screens: [{ nodeId: "embed1", title: "Home" }] }),
    );

    expect(result.error).toContain("theme is required");
    expect(result.error).toContain("400");
  });

  it("surfaces a network failure as an error", async () => {
    seedEmbedNode("embed1", "Home", "<html></html>");
    captureEmbedCanvasMock.mockResolvedValue(fakeCanvas(RASTER.width, RASTER.height));
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = JSON.parse(
      await publishToShowcase({ theme: "App", screens: [{ nodeId: "embed1", title: "Home" }] }),
    );

    expect(result.error).toBeTruthy();
  });

  it("accepts a JSON-string screens payload", async () => {
    seedEmbedNode("embed1", "Home", "<html></html>");
    captureEmbedCanvasMock.mockResolvedValue(fakeCanvas(RASTER.width, RASTER.height));
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ runId: "run-1", platform: "mobile", screens: [{ title: "Home", imageUrl: "x" }] }),
    });

    const result = JSON.parse(
      await publishToShowcase({
        theme: "App",
        screens: JSON.stringify([{ nodeId: "embed1", title: "Home" }]),
      }),
    );

    expect(result.published).toBe(1);
  });

  it("never sends an Authorization header on the publish request", async () => {
    seedEmbedNode("embed1", "Home", "<html></html>");
    captureEmbedCanvasMock.mockResolvedValue(fakeCanvas(RASTER.width, RASTER.height));
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ runId: "run-1", platform: "mobile", screens: [{ title: "Home", imageUrl: "x" }] }),
    });

    await publishToShowcase({ theme: "App", screens: [{ nodeId: "embed1", title: "Home" }] });

    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("maps a 503 to an actionable 'not configured' error", async () => {
    seedEmbedNode("embed1", "Home", "<html></html>");
    captureEmbedCanvasMock.mockResolvedValue(fakeCanvas(RASTER.width, RASTER.height));
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "Publishing from the editor is not enabled on this server" }),
    });

    const result = JSON.parse(
      await publishToShowcase({ theme: "App", screens: [{ nodeId: "embed1", title: "Home" }] }),
    );

    expect(result.error).toMatch(/isn.t configured/i);
  });

  it("returns ok:false rather than throwing when a 200 body isn't JSON", async () => {
    seedEmbedNode("embed1", "Home", "<html></html>");
    captureEmbedCanvasMock.mockResolvedValue(fakeCanvas(RASTER.width, RASTER.height));
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });

    const result = JSON.parse(
      await publishToShowcase({ theme: "App", screens: [{ nodeId: "embed1", title: "Home" }] }),
    );

    expect(result.error).toBeTruthy();
  });

  it("surfaces the runId on a 502 partial-publish failure", async () => {
    seedEmbedNode("embed1", "Home", "<html></html>");
    captureEmbedCanvasMock.mockResolvedValue(fakeCanvas(RASTER.width, RASTER.height));
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({
        error: "Failed to publish screens to the showcase",
        runId: "run-partial",
        publishedCount: 1,
      }),
    });

    const result = JSON.parse(
      await publishToShowcase({ theme: "App", screens: [{ nodeId: "embed1", title: "Home" }] }),
    );

    expect(result.error).toContain("run-partial");
    expect(result.error).toContain("showcase:delete");
  });

  it("short-circuits offline without rasterizing or calling fetch", async () => {
    offlineFlag = true;
    seedEmbedNode("embed1", "Home", "<html></html>");
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    const result = JSON.parse(
      await publishToShowcase({ theme: "App", screens: [{ nodeId: "embed1", title: "Home" }] }),
    );

    expect(result.error).toMatch(/offline/i);
    expect(captureEmbedCanvasMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
