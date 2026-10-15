import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browseScreenshot } from "@/lib/tools/browser/browseScreenshot";
import {
  BROWSER_BRIDGE_METHOD_MISSING_ERROR,
  BROWSER_NOT_AVAILABLE_ERROR,
} from "@/lib/tools/browser/shared";
import { loadImageSize } from "@/components/canvas/imageImport";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene } from "@/test/fixtures";
import { getFills } from "@/utils/fillUtils";
import { bridgeWith, j, resetEnvironment, throws } from "./harness";

vi.mock("@/lib/cloudBrowser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cloudBrowser")>()),
  cloudBrowserBridge: undefined,
  getCloudBrowserBridge: () => undefined,
}));

// The natural-size probe needs a real <img> decode; control it at the module
// boundary instead.
vi.mock("@/components/canvas/imageImport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/canvas/imageImport")>()),
  loadImageSize: vi.fn(),
}));
const loadSize = vi.mocked(loadImageSize);

beforeEach(() => {
  resetStores();
  loadSize.mockReset();
});
afterEach(resetEnvironment);

const DATA = "data:image/jpeg;base64,AAAA";
const SHOT = { imageData: DATA, width: 800, height: 600, url: "https://example.com/page", title: "Example" };
const rootCount = () => useSceneStore.getState().rootIds.length;
const node = (id: string) => useSceneStore.getState().nodesById[id];

describe("browse_screenshot without placeOnCanvas", () => {
  it("forwards args verbatim and returns the raw bridge result (annotated fields included)", async () => {
    const result = { ...SHOT, snapshotId: "s1", elements: [{ index: 0, label: "Go" }] };
    const bridge = bridgeWith({ screenshot: [result] });
    expect(await browseScreenshot({ annotate: true, fullPage: false })).toBe(j(result));
    expect(bridge.calls).toEqual([{ method: "screenshot", args: [{ annotate: true, fullPage: false }] }]);
    expect(rootCount()).toBe(0);
  });

  it("strips placeOnCanvas, x and y from the bridge args even when placeOnCanvas is not exactly true", async () => {
    // pinned as-is: x/y/placeOnCanvas are removed regardless of the flag's value.
    const bridge = bridgeWith({ screenshot: [SHOT] });
    for (const flag of [false, "true", 1, undefined]) {
      await browseScreenshot({ placeOnCanvas: flag, x: 5, y: 6, annotate: false });
    }
    expect(bridge.callsTo("screenshot").map((c) => c.args)).toEqual(Array(4).fill([{ annotate: false }]));
    expect(rootCount()).toBe(0);
  });

  it("returns the not-available error without a bridge, and the newer-app error when .screenshot is missing", async () => {
    expect(await browseScreenshot({})).toBe(j({ error: BROWSER_NOT_AVAILABLE_ERROR }));
    const bridge = bridgeWith({}, ["screenshot"]);
    expect(await browseScreenshot({ placeOnCanvas: true })).toBe(j({ error: BROWSER_BRIDGE_METHOD_MISSING_ERROR }));
    expect(bridge.calls).toEqual([]);
  });

  it("reports a rejecting screenshot", async () => {
    bridgeWith({ screenshot: [throws(new Error("gpu lost")), throws("x")] });
    expect(await browseScreenshot({})).toBe(j({ error: "gpu lost" }));
    expect(await browseScreenshot({})).toBe(j({ error: "Built-in browser command failed." }));
  });
});

describe("browse_screenshot placeOnCanvas", () => {
  it("places one image rect at x/y and returns placedNodeId/placedAt after the capture fields", async () => {
    const bridge = bridgeWith({ screenshot: [SHOT] });
    const out = await browseScreenshot({ placeOnCanvas: true, x: 30, y: 40 });
    const parsed = JSON.parse(out);
    expect(bridge.calls).toEqual([{ method: "screenshot", args: [{}] }]);
    expect(Object.keys(parsed)).toEqual(["imageData", "width", "height", "url", "title", "placedNodeId", "placedAt"]);
    expect(parsed.placedAt).toEqual({ x: 30, y: 40, width: 800, height: 600 });
    expect(rootCount()).toBe(1);
    const n = node(parsed.placedNodeId);
    expect(n).toMatchObject({
      type: "rect",
      name: "Screenshot — Example",
      x: 30,
      y: 40,
      width: 800,
      height: 600,
      cornerRadius: 0,
    });
    expect(getFills(n)[0]).toMatchObject({ type: "image", image: { url: DATA, mode: "fill" } });
    expect(loadSize).not.toHaveBeenCalled();
  });

  it("is a single undo step", async () => {
    bridgeWith({ screenshot: [SHOT] });
    await browseScreenshot({ placeOnCanvas: true, x: 0, y: 0 });
    expect(useHistoryStore.getState().past).toHaveLength(1);
  });

  it("auto-places right of existing content (850,100) when x/y are omitted, names by hostname when the title is blank", async () => {
    seedScene();
    bridgeWith({ screenshot: [{ ...SHOT, title: "   " }] });
    const parsed = JSON.parse(await browseScreenshot({ placeOnCanvas: true }));
    expect(node(parsed.placedNodeId)).toMatchObject({ x: 850, name: "Screenshot — example.com" });
    expect(parsed.placedAt.x).toBe(850);
  });

  it("auto-places on an empty canvas", async () => {
    bridgeWith({ screenshot: [SHOT] });
    const parsed = JSON.parse(await browseScreenshot({ placeOnCanvas: true }));
    expect(parsed.placedAt).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it("ignores a lone or non-finite coordinate and auto-places instead", async () => {
    seedScene();
    bridgeWith({ screenshot: [SHOT] });
    for (const coords of [{ x: 5 }, { y: 5 }, { x: "5", y: "6" }, { x: NaN, y: 1 }, { x: Infinity, y: 1 }]) {
      const parsed = JSON.parse(await browseScreenshot({ placeOnCanvas: true, ...coords }));
      expect(parsed.placedAt.x).not.toBe(5);
    }
  });

  it("falls back to hostname 'browser' for an unparsable url and no title, and truncates a long title to 60 chars", async () => {
    bridgeWith({
      screenshot: [
        { ...SHOT, title: "", url: "not a url" },
        { ...SHOT, title: undefined, url: undefined },
        { ...SHOT, title: "T".repeat(80) },
        { ...SHOT, title: 5, url: 7 },
      ],
    });
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = JSON.parse(await browseScreenshot({ placeOnCanvas: true, x: i, y: 0 }));
      names.push(node(p.placedNodeId).name);
    }
    expect(names).toEqual([
      "Screenshot — browser",
      "Screenshot — browser",
      `Screenshot — ${"T".repeat(59)}…`,
      "Screenshot — browser",
    ]);
  });

  it("measures the image when the capture has no usable size, else falls back to 1280x800", async () => {
    bridgeWith({
      screenshot: [
        { imageData: DATA },
        { imageData: DATA, width: 0, height: 600 },
        { imageData: DATA, width: 800, height: "600" },
        { imageData: DATA, width: -1, height: -1 },
        { imageData: DATA, width: 10 },
      ],
    });
    loadSize
      .mockResolvedValueOnce({ width: 321, height: 123 })
      .mockResolvedValueOnce({ width: 0, height: 5 })
      .mockRejectedValueOnce(new Error("decode"))
      .mockResolvedValueOnce({ width: Number.NaN, height: 5 })
      .mockResolvedValueOnce({ width: 50, height: 60 });
    const sizes: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      const p = JSON.parse(await browseScreenshot({ placeOnCanvas: true, x: i * 2000, y: 0 }));
      sizes.push([p.placedAt.width, p.placedAt.height, node(p.placedNodeId).width, node(p.placedNodeId).height]);
    }
    expect(sizes).toEqual([
      [321, 123, 321, 123],
      [1280, 800, 1280, 800],
      [1280, 800, 1280, 800],
      [1280, 800, 1280, 800],
      [50, 60, 50, 60],
    ]);
    expect(loadSize).toHaveBeenCalledTimes(5);
    expect(loadSize).toHaveBeenCalledWith(DATA);
  });

  it("annotate: re-captures with annotate:false, places the PLAIN image, returns the annotated fields", async () => {
    const annotated = { ...SHOT, imageData: "data:image/jpeg;base64,MARKED", snapshotId: "s9", elements: [{ index: 0 }] };
    const plain = { ...SHOT, imageData: "data:image/jpeg;base64,PLAIN", width: 400, height: 300, title: "Plain" };
    const bridge = bridgeWith({ screenshot: [annotated, plain] });
    const parsed = JSON.parse(await browseScreenshot({ placeOnCanvas: true, annotate: true, x: 1, y: 2, fullPage: true }));
    expect(bridge.callsTo("screenshot").map((c) => c.args)).toEqual([
      [{ annotate: true, fullPage: true }],
      [{ annotate: false, fullPage: true }],
    ]);
    // Result = annotated capture + placement of the plain one.
    expect(parsed).toEqual({ ...annotated, placedNodeId: expect.any(String), placedAt: { x: 1, y: 2, width: 400, height: 300 } });
    const n = node(parsed.placedNodeId);
    expect(n).toMatchObject({ width: 400, height: 300, name: "Screenshot — Plain" });
    expect(getFills(n)[0]).toMatchObject({ image: { url: "data:image/jpeg;base64,PLAIN" } });
  });

  it("annotate: the plain re-capture failing yields placeError (reason from error / 'no image data') and places nothing", async () => {
    const annotated = { ...SHOT, snapshotId: "s9" };
    const cases: Array<[unknown, string]> = [
      [{ error: "tab gone" }, "tab gone"],
      [{ imageData: DATA, error: "late error" }, "late error"],
      [{ width: 1 }, "no image data"],
      [{ imageData: 5 }, "no image data"],
      [[1], "browse_act: malformed result from the browser bridge."],
      [throws(new Error("boom")), "boom"],
    ];
    for (const [plain, reason] of cases) {
      bridgeWith({ screenshot: [annotated, plain] });
      const out = await browseScreenshot({ placeOnCanvas: true, annotate: true });
      expect(out).toBe(j({ ...annotated, placeError: `Plain capture for the canvas failed: ${reason}` }));
    }
    expect(rootCount()).toBe(0);
  });

  it("annotate:false (or any non-true value) does a single capture", async () => {
    const bridge = bridgeWith({ screenshot: [SHOT] });
    await browseScreenshot({ placeOnCanvas: true, annotate: false, x: 0, y: 0 });
    await browseScreenshot({ placeOnCanvas: true, annotate: "true", x: 100, y: 0 });
    expect(bridge.callsTo("screenshot")).toHaveLength(2);
  });

  it("returns placeError and places nothing when the capture has no string imageData", async () => {
    bridgeWith({ screenshot: [{ width: 5, url: "u" }, { imageData: 5 }] });
    expect(await browseScreenshot({ placeOnCanvas: true })).toBe(
      j({ width: 5, url: "u", placeError: "The capture returned no image data." })
    );
    expect(await browseScreenshot({ placeOnCanvas: true })).toBe(
      j({ imageData: 5, placeError: "The capture returned no image data." })
    );
    expect(rootCount()).toBe(0);
  });

  it("returns an error result raw (no placement) and does not re-capture", async () => {
    const bridge = bridgeWith({ screenshot: [{ error: "no tab", imageData: DATA }] });
    expect(await browseScreenshot({ placeOnCanvas: true, annotate: true })).toBe(
      j({ error: "no tab", imageData: DATA })
    );
    expect(bridge.callsTo("screenshot")).toHaveLength(1);
    expect(rootCount()).toBe(0);
  });

  it("returns the malformed-result error raw for a non-object capture", async () => {
    bridgeWith({ screenshot: [[1]] });
    expect(await browseScreenshot({ placeOnCanvas: true })).toBe("[1]");
    expect(rootCount()).toBe(0);
  });

  it("returns the not-available / newer-app error raw with placeOnCanvas", async () => {
    expect(await browseScreenshot({ placeOnCanvas: true })).toBe(j({ error: BROWSER_NOT_AVAILABLE_ERROR }));
  });
});
