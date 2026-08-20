import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { createSnapshot } from "@/store/sceneStore/helpers/history";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
import { createImagePaint, clearLegacyFillProps } from "@/utils/fillUtils";
import type { ImagePaint } from "@/types/scene";
import { removeBackgroundFromUrl, removeBackgroundOnNode } from "@/lib/imageOps/removeBackground";
import {
  MAX_VECTORIZE_NODES,
  vectorizeFromUrl,
  vectorizeNode,
} from "@/lib/imageOps/vectorize";
import { stubSvgGetBBox } from "@/test/svgGetBBoxStub";
import * as svgUtils from "@/utils/svgUtils";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function undo() {
  const snapshot = createSnapshot(useSceneStore.getState());
  const prev = useHistoryStore.getState().undo(snapshot);
  if (prev) useSceneStore.getState().restoreSnapshot(prev);
}

/** Seeds rect1 (a child of frame1, see fixtures.ts) with an image fill that
 * also carries a crop + adjustments, so tests can assert they survive a
 * url-only rewrite. */
function seedImageFillOnRect1(url: string, extra?: Partial<ImagePaint["image"]>) {
  const paint = createImagePaint({
    url,
    mode: "fit",
    crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
    adjustments: { brightness: 0.2, contrast: 0, saturation: 0, temperature: 0, tint: 0 },
    ...extra,
  });
  useSceneStore.getState().updateNode("rect1", {
    fills: [paint],
    ...clearLegacyFillProps(),
  });
  return paint;
}

/** Seeds frame1 (which has children rect1/text1, see fixtures.ts) with an
 * image fill — `fills` lives on `BaseNode`, so a container can carry one
 * too. Used to exercise the "refuse to vectorize a node with children"
 * guard. */
function seedImageFillOnFrame1(url: string) {
  useSceneStore.getState().updateNode("frame1", {
    fills: [createImagePaint({ url, mode: "fill" })],
    ...clearLegacyFillProps(),
  });
}

/** A SVG whose raw text alone (before parsing) already exceeds
 * MAX_VECTORIZE_NODES, used to assert the cheap pre-parse guard rejects it
 * without ever calling the expensive `parseSvgToNodes`. */
function hugeSvg(count: number): string {
  const paths = Array.from({ length: count }, () => `<path d="M0,0 L1,1" fill="#000"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">${paths}</svg>`;
}

function rectSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80">
    <rect x="10" y="10" width="80" height="60" fill="#ff0000" />
  </svg>`;
}

/** A rect that exactly covers the SVG canvas (no internal padding), so the
 * parsed node's bbox equals the full svgWidth/svgHeight — used to assert
 * the scale+offset math places the result exactly over the source node's
 * box, without an unrelated internal-padding offset muddying the numbers. */
function fullCanvasRectSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80">
    <rect x="0" y="0" width="100" height="80" fill="#ff0000" />
  </svg>`;
}

/** Two rects laid out inside one 60x60 canvas — a multi-shape SVG, so the
 * parsed tree is a group with more than one child and child coordinates are
 * parent-relative. Single-shape fixtures can't tell a correct root shift
 * apart from one that also (wrongly) shifts the children. */
function twoRectSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
    <rect x="0" y="0" width="50" height="50" fill="#ff0000" />
    <rect x="50" y="50" width="10" height="10" fill="#00ff00" />
  </svg>`;
}

/** An SVG with more `<rect>` elements than MAX_VECTORIZE_NODES, to exercise
 * the complexity guard. */
function tooComplexSvg(count: number): string {
  const rects = Array.from(
    { length: count },
    (_, i) => `<rect x="${i}" y="0" width="1" height="1" fill="#000" />`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="10" viewBox="0 0 1000 10">${rects}</svg>`;
}

/** `totalShapes` rects, only the first `keptCount` carrying a `fill` — the
 * rest resolve to neither fill nor stroke and get silently dropped by
 * parseSvgToNodes (see svgUtils.ts), exercising the droppedShapes guard. */
function mixedFillSvg(totalShapes: number, keptCount: number): string {
  const rects = Array.from({ length: totalShapes }, (_, i) => {
    const fillAttr = i < keptCount ? ' fill="#000"' : "";
    return `<rect x="${i}" y="0" width="1" height="1"${fillAttr}/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalShapes}" height="10" viewBox="0 0 ${totalShapes} 10">${rects}</svg>`;
}

/** Puts rect1 (see fixtures.ts) between two other siblings under frame1, so
 * z-order-preservation tests have neighbors on both sides to check against. */
function seedRect1BetweenSiblings(): void {
  const state = useSceneStore.getState();
  const before = {
    id: "before1",
    type: "rect",
    name: "Before",
    x: 5,
    y: 5,
    width: 10,
    height: 10,
    fill: "#111111",
  } as unknown as (typeof state.nodesById)[string];
  const after = {
    id: "after1",
    type: "rect",
    name: "After",
    x: 200,
    y: 5,
    width: 10,
    height: 10,
    fill: "#222222",
  } as unknown as (typeof state.nodesById)[string];
  useSceneStore.setState({
    nodesById: { ...state.nodesById, before1: before, after1: after },
    parentById: { ...state.parentById, before1: "frame1", after1: "frame1" },
    childrenById: { ...state.childrenById, frame1: ["before1", "rect1", "after1"] },
  });
}

beforeEach(() => {
  resetStores();
  seedScene();
  stubSvgGetBBox();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("removeBackgroundOnNode", () => {
  it("replaces the node's image fill url, preserving mode/crop/adjustments", async () => {
    const paint = seedImageFillOnRect1("https://cdn/before.png");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ url: "https://cdn/after.png" })));

    const result = await removeBackgroundOnNode("rect1");
    expect(result.url).toBe("https://cdn/after.png");

    const rect = useSceneStore.getState().nodesById["rect1"] as unknown as { fills: ImagePaint[] };
    expect(rect.fills).toHaveLength(1);
    expect(rect.fills[0].id).toBe(paint.id);
    expect(rect.fills[0].image.url).toBe("https://cdn/after.png");
    expect(rect.fills[0].image.mode).toBe("fit");
    expect(rect.fills[0].image.crop).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
    expect(rect.fills[0].image.adjustments).toEqual({
      brightness: 0.2,
      contrast: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
    });
  });

  it("uploads a data: source url before calling remove-background", async () => {
    seedImageFillOnRect1("data:image/png;base64,AAAA");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.toString().includes("/api/upload-image")) {
        expect(JSON.parse(init!.body as string)).toEqual({ image: "data:image/png;base64,AAAA" });
        return jsonResponse({ url: "https://cdn/uploaded.png" });
      }
      if (url.toString().includes("/api/remove-background")) {
        expect(JSON.parse(init!.body as string)).toEqual({ image_url: "https://cdn/uploaded.png" });
        return jsonResponse({ url: "https://cdn/removed.png" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await removeBackgroundOnNode("rect1");
    expect(result.url).toBe("https://cdn/removed.png");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("errors and does not mutate the scene when the network fails", async () => {
    seedImageFillOnRect1("https://cdn/before.png");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "down" }, 500)));
    const before = JSON.stringify(useSceneStore.getState().nodesById["rect1"]);

    await expect(removeBackgroundOnNode("rect1")).rejects.toThrow();
    expect(JSON.stringify(useSceneStore.getState().nodesById["rect1"])).toBe(before);
  });

  it("errors with a specific message on 503 (not configured)", async () => {
    seedImageFillOnRect1("https://cdn/before.png");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 503)));
    await expect(removeBackgroundOnNode("rect1")).rejects.toThrow(/not configured/i);
  });

  it("fails locally without a network request when offline", async () => {
    seedImageFillOnRect1("https://cdn/before.png");
    vi.stubGlobal("navigator", { onLine: false });
    const fetchMock = vi.fn(async () => jsonResponse({ url: "https://cdn/x.png" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(removeBackgroundOnNode("rect1")).rejects.toThrow(/offline/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("errors clearly when the node does not exist", async () => {
    await expect(removeBackgroundOnNode("nope")).rejects.toThrow(/not found/i);
  });

  it("errors clearly when the node has no image fill", async () => {
    await expect(removeBackgroundOnNode("text1")).rejects.toThrow(/no image fill/i);
  });

  it("removeBackgroundFromUrl operates on a bare url with no node involved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ url: "https://cdn/after.png" })));
    const result = await removeBackgroundFromUrl("https://cdn/before.png");
    expect(result.url).toBe("https://cdn/after.png");
  });
});

describe("vectorizeNode mode: image", () => {
  it("replaces the node's image fill url in place", async () => {
    const paint = seedImageFillOnRect1("https://cdn/before.png");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: rectSvg() })),
    );

    const result = await vectorizeNode("rect1", { mode: "image" });
    expect(result.url).toBe("https://cdn/vector.svg");

    const rect = useSceneStore.getState().nodesById["rect1"] as unknown as { fills: ImagePaint[] };
    expect(rect.fills[0].id).toBe(paint.id);
    expect(rect.fills[0].image.url).toBe("https://cdn/vector.svg");
    expect(rect.fills[0].image.mode).toBe("fit");
  });
});

describe("vectorizeNode mode: layers", () => {
  it("inserts parsed path layers in place of the source node, matching its position and size", async () => {
    seedImageFillOnRect1("https://cdn/before.png");
    const sourceBefore = useSceneStore.getState().nodesById["rect1"];

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: fullCanvasRectSvg() })),
    );

    const result = await vectorizeNode("rect1", { mode: "layers" });
    expect(result.tooComplex).toBeUndefined();
    expect(result.nodeId).toBeTruthy();

    const state = useSceneStore.getState();
    // Source node is gone.
    expect(state.nodesById["rect1"]).toBeUndefined();

    const newNode = state.nodesById[result.nodeId!];
    expect(newNode).toBeTruthy();
    // Same parent (frame1), same position/size as the deleted source.
    expect(state.parentById[result.nodeId!]).toBe("frame1");
    expect(newNode.x).toBeCloseTo(sourceBefore.x, 5);
    expect(newNode.y).toBeCloseTo(sourceBefore.y, 5);
    expect(newNode.width).toBeCloseTo(sourceBefore.width, 5);
    expect(newNode.height).toBeCloseTo(sourceBefore.height, 5);

    // Selection moved to the new node.
    expect(useSelectionStore.getState().selectedIds).toEqual([result.nodeId]);
  });

  it("preserves the source node's index among siblings (z-order), not just position/size", async () => {
    seedImageFillOnRect1("https://cdn/before.png");
    seedRect1BetweenSiblings();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: fullCanvasRectSvg() })),
    );

    const result = await vectorizeNode("rect1", { mode: "layers" });

    const state = useSceneStore.getState();
    expect(state.childrenById["frame1"]).toEqual(["before1", result.nodeId, "after1"]);
    // Neighbors themselves are untouched.
    expect(state.nodesById["before1"]).toBeTruthy();
    expect(state.nodesById["after1"]).toBeTruthy();
  });

  it("reports droppedShapes and still updates the scene when some source shapes have no fill/stroke", async () => {
    seedImageFillOnRect1("https://cdn/before.png");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: mixedFillSvg(20, 10) })),
    );

    const result = await vectorizeNode("rect1", { mode: "layers" });
    expect(result.tooComplex).toBeUndefined();
    expect(result.droppedShapes).toBe(10);

    // The operation still ran despite the partial loss.
    expect(useSceneStore.getState().nodesById["rect1"]).toBeUndefined();
    expect(useSceneStore.getState().nodesById[result.nodeId!]).toBeTruthy();
  });

  it("does not report droppedShapes when the loss is below the significance threshold", async () => {
    seedImageFillOnRect1("https://cdn/before.png");
    vi.stubGlobal(
      "fetch",
      // 20 shapes, only 2 dropped: below both DROP_ABS_THRESHOLD and the ratio.
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: mixedFillSvg(20, 18) })),
    );

    const result = await vectorizeNode("rect1", { mode: "layers" });
    expect(result.droppedShapes).toBeUndefined();
  });

  it("is a single undo step: one Cmd+Z restores the original image node", async () => {
    seedImageFillOnRect1("https://cdn/before.png");
    const pastBefore = useHistoryStore.getState().past.length;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: rectSvg() })),
    );
    const result = await vectorizeNode("rect1", { mode: "layers" });

    expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);
    expect(useSceneStore.getState().nodesById["rect1"]).toBeUndefined();

    undo();

    const state = useSceneStore.getState();
    expect(state.nodesById["rect1"]).toBeTruthy();
    expect(state.nodesById[result.nodeId!]).toBeUndefined();
    const rect = state.nodesById["rect1"] as unknown as { fills: ImagePaint[] };
    expect(rect.fills[0].image.url).toBe("https://cdn/before.png");
  });

  it("complexity guard: 600+ nodes are not inserted, scene stays untouched", async () => {
    seedImageFillOnRect1("https://cdn/before.png");
    const before = JSON.stringify(useSceneStore.getState().nodesById);
    const pastBefore = useHistoryStore.getState().past.length;

    const bigSvg = tooComplexSvg(MAX_VECTORIZE_NODES + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: bigSvg })),
    );

    const result = await vectorizeNode("rect1", { mode: "layers" });
    expect(result.tooComplex).toBe(true);
    expect(result.nodeCount).toBeGreaterThan(MAX_VECTORIZE_NODES);
    expect(result.url).toBe("https://cdn/vector.svg");

    expect(JSON.stringify(useSceneStore.getState().nodesById)).toBe(before);
    expect(useHistoryStore.getState().past.length).toBe(pastBefore);
  });

  it("errors and does not mutate when the network fails", async () => {
    seedImageFillOnRect1("https://cdn/before.png");
    const before = JSON.stringify(useSceneStore.getState().nodesById);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));

    await expect(vectorizeNode("rect1", { mode: "layers" })).rejects.toThrow();
    expect(JSON.stringify(useSceneStore.getState().nodesById)).toBe(before);
  });

  it("errors clearly when the node has no image fill", async () => {
    await expect(vectorizeNode("text1", { mode: "layers" })).rejects.toThrow(/no image fill/i);
  });

  it("errors clearly when the node does not exist", async () => {
    await expect(vectorizeNode("nope", { mode: "layers" })).rejects.toThrow(/not found/i);
  });

  it("refuses a node with children instead of deleting its subtree, without calling the backend", async () => {
    seedImageFillOnFrame1("https://cdn/before.png");
    const before = JSON.stringify(useSceneStore.getState().nodesById);
    const fetchMock = vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: rectSvg() }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(vectorizeNode("frame1", { mode: "layers" })).rejects.toThrow(/child/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(useSceneStore.getState().nodesById)).toBe(before);
    expect(useSceneStore.getState().nodesById["rect1"]).toBeTruthy();
    expect(useSceneStore.getState().nodesById["text1"]).toBeTruthy();
  });

  it("mode: image is unaffected by the children guard (it never deletes the node)", async () => {
    seedImageFillOnFrame1("https://cdn/before.png");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: rectSvg() })),
    );

    const result = await vectorizeNode("frame1", { mode: "image" });
    expect(result.url).toBe("https://cdn/vector.svg");
    expect(useSceneStore.getState().nodesById["rect1"]).toBeTruthy();
    expect(useSceneStore.getState().nodesById["text1"]).toBeTruthy();
  });

  it("rejects a hopelessly large source SVG before parsing it (cheap pre-check, no forced layout)", async () => {
    seedImageFillOnRect1("https://cdn/before.png");
    const parseSpy = vi.spyOn(svgUtils, "parseSvgToNodes");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: hugeSvg(20000) })),
    );

    const result = await vectorizeNode("rect1", { mode: "layers" });
    expect(result.tooComplex).toBe(true);
    expect(result.nodeCount).toBeGreaterThan(MAX_VECTORIZE_NODES);
    expect(parseSpy).not.toHaveBeenCalled();
    // Nothing was inserted/deleted — the source node is exactly as it was.
    expect(useSceneStore.getState().nodesById["rect1"]).toBeTruthy();
  });
});

describe("vectorizeFromUrl", () => {
  it("mode image returns just the url, no scene involved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: rectSvg() })),
    );
    const result = await vectorizeFromUrl("https://cdn/before.png", { mode: "image" });
    expect(result).toEqual({ url: "https://cdn/vector.svg" });
  });

  it("mode layers actually inserts the parsed tree at root level (not a silent no-op)", async () => {
    const rootIdsBefore = [...useSceneStore.getState().rootIds];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: fullCanvasRectSvg() })),
    );

    const result = await vectorizeFromUrl("https://cdn/before.png", { mode: "layers" });
    expect(result.tooComplex).toBeUndefined();
    expect(result.nodeId).toBeTruthy();

    const state = useSceneStore.getState();
    expect(state.rootIds).toEqual([...rootIdsBefore, result.nodeId]);
    expect(state.nodesById[result.nodeId!]).toBeTruthy();
    expect(state.parentById[result.nodeId!]).toBeNull();
    expect(useSelectionStore.getState().selectedIds).toEqual([result.nodeId]);
  });

  it("mode layers, empty canvas: inserts at the origin", async () => {
    useSceneStore.setState({ nodesById: {}, parentById: {}, childrenById: {}, rootIds: [] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: fullCanvasRectSvg() })),
    );
    const result = await vectorizeFromUrl("https://cdn/before.png", { mode: "layers" });
    const node = useSceneStore.getState().nodesById[result.nodeId!];
    expect(node.x).toBe(0);
    expect(node.y).toBe(0);
  });

  it("mode layers reports tooComplex without inserting anything", async () => {
    const bigSvg = tooComplexSvg(MAX_VECTORIZE_NODES + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: bigSvg })),
    );
    const rootIdsBefore = [...useSceneStore.getState().rootIds];
    const result = await vectorizeFromUrl("https://cdn/before.png", { mode: "layers" });
    expect(result.tooComplex).toBe(true);
    expect(result.nodeCount).toBeGreaterThan(MAX_VECTORIZE_NODES);
    expect(result.nodeId).toBeUndefined();
    expect(useSceneStore.getState().rootIds).toEqual(rootIdsBefore);
  });

  it("rejects a hopelessly large source SVG before parsing it", async () => {
    const parseSpy = vi.spyOn(svgUtils, "parseSvgToNodes");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: hugeSvg(20000) })),
    );
    const result = await vectorizeFromUrl("https://cdn/before.png", { mode: "layers" });
    expect(result.tooComplex).toBe(true);
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it("mode layers shifts only the root — children stay parent-relative", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: twoRectSvg() })),
    );

    const result = await vectorizeFromUrl("https://cdn/before.png", { mode: "layers" });
    const state = useSceneStore.getState();
    const root = state.nodesById[result.nodeId!];
    // Placed clear of the seeded scene's root-level content...
    expect(root.x).toBeGreaterThan(0);
    // ...and the children keep the coordinates parseSvgToNodes gave them,
    // which are relative to that root, not shifted along with it.
    const children = state.childrenById[result.nodeId!].map((id) => state.nodesById[id]);
    expect(children).toHaveLength(2);
    expect(children.map((c) => [c.x, c.y])).toEqual([
      [0, 0],
      [50, 50],
    ]);
  });

  it("mode layers reports droppedShapes for fill/stroke-less source shapes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ url: "https://cdn/vector.svg", svg: mixedFillSvg(20, 10) })),
    );
    const result = await vectorizeFromUrl("https://cdn/before.png", { mode: "layers" });
    expect(result.droppedShapes).toBe(10);
  });
});
