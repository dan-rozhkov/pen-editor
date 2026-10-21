import { beforeEach, describe, expect, it, vi } from "vitest";
import { docCreate, docInsertImage } from "../docTools";
import { getDoc } from "@/lib/docs/docStore";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  panelActive: vi.fn(() => true),
  panelCallTool: vi.fn(),
  getScreenshot: vi.fn(),
}));
vi.mock("@/lib/apiBase", () => ({ apiFetch: mocks.apiFetch, isOffline: () => false }));
vi.mock("@/lib/canvasLink/panelRuntime", () => ({
  isPanelCanvasLinkActive: mocks.panelActive,
  panelCallTool: mocks.panelCallTool,
}));
vi.mock("../getScreenshot", () => ({ getScreenshot: mocks.getScreenshot }));

const run = async (args: Record<string, unknown>, context?: { sessionId?: string; toolCallId?: string; signal?: AbortSignal }) =>
  JSON.parse(await docInsertImage(args, context));

const upload = (status: number, body: unknown = { url: "https://cdn/up.png" }) =>
  mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

async function makeDoc(markdown = "# A\n\ntext\n"): Promise<string> {
  return JSON.parse(await docCreate({ title: "T", markdown })).docId;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.panelActive.mockReturnValue(true);
});

describe("doc_insert_image", () => {
  it("inserts an http(s) imageUrl as-is, after a heading", async () => {
    const docId = await makeDoc("# A\n\ntext\n\n# B\n");
    const r = await run({ docId, imageUrl: "https://x/y.png", alt: "Pic", afterHeading: "A" });
    expect(r).toEqual({ docId, url: "https://x/y.png" });
    expect(getDoc(docId)?.markdown).toBe("# A\n\ntext\n\n![Pic](https://x/y.png)\n\n# B\n");
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it("appends at the end without afterHeading", async () => {
    const docId = await makeDoc();
    await run({ docId, imageUrl: "http://x/y.png", alt: "Pic" });
    expect(getDoc(docId)?.markdown).toBe("# A\n\ntext\n\n![Pic](http://x/y.png)\n");
  });

  it("uploads a data: imageUrl and writes the https url", async () => {
    const docId = await makeDoc();
    upload(200);
    const r = await run({ docId, imageUrl: "data:image/png;base64,AAAA", alt: "Pic" });
    expect(r.url).toBe("https://cdn/up.png");
    expect(getDoc(docId)?.markdown).toContain("![Pic](https://cdn/up.png)");
    expect(getDoc(docId)?.markdown).not.toContain("data:");
  });

  it("screenshots a node through the canvas link, uploads it", async () => {
    const docId = await makeDoc();
    mocks.panelCallTool.mockResolvedValueOnce(JSON.stringify({ imageData: "data:image/png;base64,BBBB" }));
    upload(200);
    const signal = new AbortController().signal;
    const r = await run({ docId, nodeId: "n1", alt: "Screen" }, { sessionId: "s1", toolCallId: "tc", signal });
    expect(r.url).toBe("https://cdn/up.png");
    expect(mocks.panelCallTool).toHaveBeenCalledWith("s1", "get_screenshot", { nodeId: "n1", maxSide: 2048 }, expect.objectContaining({ signal, timeoutMs: expect.any(Number) }));
    expect(mocks.getScreenshot).not.toHaveBeenCalled();
  });

  it("uses the local get_screenshot handler outside the panel", async () => {
    const docId = await makeDoc();
    mocks.panelActive.mockReturnValue(false);
    mocks.getScreenshot.mockResolvedValueOnce(JSON.stringify({ imageData: "data:image/png;base64,CCCC" }));
    upload(200);
    await run({ docId, nodeId: "n1", alt: "Screen" });
    expect(mocks.getScreenshot).toHaveBeenCalledWith({ nodeId: "n1", maxSide: 2048 }, undefined);
    expect(mocks.panelCallTool).not.toHaveBeenCalled();
  });

  it("treats a blank imageUrl as absent, so a nodeId call works", async () => {
    const docId = await makeDoc();
    mocks.panelCallTool.mockResolvedValueOnce(JSON.stringify({ imageData: "data:image/png;base64,BBBB" }));
    upload(200);
    const r = await run({ docId, nodeId: "n1", imageUrl: "", alt: "Screen" }, { sessionId: "s1" });
    expect(r.url).toBe("https://cdn/up.png");
  });

  it("trims the nodeId", async () => {
    const docId = await makeDoc();
    mocks.panelCallTool.mockResolvedValueOnce(JSON.stringify({ imageData: "data:image/png;base64,BBBB" }));
    upload(200);
    await run({ docId, nodeId: " n1 ", alt: "Screen" }, { sessionId: "s1" });
    expect(mocks.panelCallTool).toHaveBeenCalledWith("s1", "get_screenshot", { nodeId: "n1", maxSide: 2048 }, expect.anything());
  });

  it.each([[""], ["   "]])("appends at the end for a blank afterHeading %j", async (afterHeading) => {
    const docId = await makeDoc("# A\n\ntext\n\n# B\n");
    await run({ docId, imageUrl: "https://x/y.png", alt: "Pic", afterHeading });
    expect(getDoc(docId)?.markdown).toBe("# A\n\ntext\n\n# B\n\n![Pic](https://x/y.png)\n");
  });

  it("trims the imageUrl and the heading", async () => {
    const docId = await makeDoc("# A\n\ntext\n\n# B\n");
    await run({ docId, imageUrl: " https://x/y.png ", alt: "Pic", afterHeading: " A " });
    expect(getDoc(docId)?.markdown).toBe("# A\n\ntext\n\n![Pic](https://x/y.png)\n\n# B\n");
  });

  it("does not write the doc when the call is aborted during the upload", async () => {
    const docId = await makeDoc();
    const controller = new AbortController();
    mocks.apiFetch.mockReturnValueOnce(new Promise(() => {})); // an upload that never settles
    const pending = run({ docId, imageUrl: "data:image/png;base64,AAAA", alt: "Pic" }, { signal: controller.signal });
    controller.abort();
    expect((await pending).error).toMatch(/cancelled/);
    expect(getDoc(docId)?.markdown).toBe("# A\n\ntext\n");
  });

  it("does not write the doc when the call is aborted after the screenshot", async () => {
    const docId = await makeDoc();
    const controller = new AbortController();
    mocks.panelCallTool.mockImplementationOnce(async () => {
      controller.abort();
      return JSON.stringify({ imageData: "data:image/png;base64,BBBB" });
    });
    const r = await run({ docId, nodeId: "n1", alt: "Screen" }, { sessionId: "s1", signal: controller.signal });
    expect(r.error).toMatch(/cancelled/);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(getDoc(docId)?.markdown).toBe("# A\n\ntext\n");
  });

  it.each([
    ["neither source", { alt: "a" }, /exactly one/],
    ["both sources", { alt: "a", imageUrl: "https://x/y.png", nodeId: "n" }, /exactly one/],
    ["missing alt", { imageUrl: "https://x/y.png" }, /alt is required/],
    ["blob url", { alt: "a", imageUrl: "blob:http://x/1" }, /http\(s\)/],
    ["javascript url", { alt: "a", imageUrl: "javascript:alert(1)" }, /http\(s\)/],
    ["heading not found", { alt: "a", imageUrl: "https://x/y.png", afterHeading: "Zzz" }, /not found/],
  ])("rejects %s", async (_n, extra, pattern) => {
    const docId = await makeDoc();
    const r = await run({ docId, ...extra });
    expect(r.error).toMatch(pattern);
    expect(getDoc(docId)?.markdown).toBe("# A\n\ntext\n");
  });

  it("errors on an unknown or missing docId", async () => {
    expect((await run({ docId: "nope", imageUrl: "https://x/y.png", alt: "a" })).error).toMatch(/Unknown docId/);
    expect((await run({ imageUrl: "https://x/y.png", alt: "a" })).error).toMatch(/docId is required/);
  });

  it.each([
    ["upload 503", () => upload(503, {}), /not configured/],
    ["upload 500", () => upload(500, {}), /failed \(500\)/],
  ])("surfaces %s and leaves the doc unchanged", async (_n, arrange, pattern) => {
    const docId = await makeDoc();
    arrange();
    const r = await run({ docId, imageUrl: "data:image/png;base64,AAAA", alt: "a" });
    expect(r.error).toMatch(pattern);
    expect(getDoc(docId)?.markdown).toBe("# A\n\ntext\n");
  });

  it.each([
    ["error result", JSON.stringify({ error: "Node not found: n1" }), /Node not found/],
    ["no image", JSON.stringify({}), /no image/],
    ["garbage", "not json", /could not be read/],
  ])("reports a get_screenshot %s", async (_n, result, pattern) => {
    const docId = await makeDoc();
    mocks.panelCallTool.mockResolvedValueOnce(result);
    const r = await run({ docId, nodeId: "n1", alt: "a" }, { sessionId: "s1" });
    expect(r.error).toMatch(pattern);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
});
