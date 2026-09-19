import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { stubSvgGetBBox } from "@/test/svgGetBBoxStub";
import { useSceneStore } from "@/store/sceneStore";
import { useChatStore } from "@/store/chatStore";
import { useAiSvgPreviewStore, svgPreviewKey } from "@/store/aiSvgPreviewStore";

const streamQuiverVector = vi.hoisted(() => vi.fn());
vi.mock("@/lib/quiverVector/stream", () => ({
  streamQuiverVector,
  QuiverVectorError: class extends Error {},
}));

const { generateVector } = await import("../index");

const ARTWORK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
  '<rect width="80" height="80" fill="#FFFAF3"/>' +
  '<path d="m10 10h60v60h-60z" fill="#FD720D"/>' +
  "</svg>";

const CONTEXT = { sessionId: "s1", toolCallId: "call-1" };

beforeEach(() => {
  // happy-dom has no SVGGraphicsElement.getBBox, and the importer drops any
  // shape whose bbox measures 0x0 — without this every parse returns null.
  stubSvgGetBBox();
  resetStores();
  useAiSvgPreviewStore.getState().reset();
  streamQuiverVector.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generate_vector handler", () => {
  it("rejects an empty prompt without calling the backend", async () => {
    const result = JSON.parse(await generateVector({ prompt: "  " }, CONTEXT));
    expect(result.success).toBe(false);
    expect(streamQuiverVector).not.toHaveBeenCalled();
  });

  it("commits nodes from the final document", async () => {
    streamQuiverVector.mockResolvedValue(ARTWORK);
    const before = Object.keys(useSceneStore.getState().nodesById).length;

    const result = JSON.parse(
      await generateVector({ prompt: "an orange square", x: 0, y: 0 }, CONTEXT),
    );

    expect(result.success).toBe(true);
    expect(Object.keys(useSceneStore.getState().nodesById).length).toBeGreaterThan(before);
  });

  it("passes instructions through and omits them when blank", async () => {
    streamQuiverVector.mockResolvedValue(ARTWORK);

    await generateVector({ prompt: "a mark", instructions: "flat, two colors" }, CONTEXT);
    expect(streamQuiverVector.mock.calls[0][0].instructions).toBe("flat, two colors");

    streamQuiverVector.mockClear();
    await generateVector({ prompt: "a mark", instructions: "   " }, CONTEXT);
    expect(streamQuiverVector.mock.calls[0][0].instructions).toBeUndefined();
  });

  it("stages a preview per finished element and clears it after commit", async () => {
    const frames: number[] = [];
    streamQuiverVector.mockImplementation(async (options: {
      onProgress?: (p: { svg: string; completeElements: number }) => void;
    }) => {
      options.onProgress?.({ svg: '<svg viewBox="0 0 80 80"><rect/></svg>', completeElements: 1 });
      frames.push(
        Object.keys(useAiSvgPreviewStore.getState().drafts).length,
      );
      return ARTWORK;
    });

    await generateVector({ prompt: "a mark", x: 0, y: 0 }, CONTEXT);

    // The preview existed while streaming...
    expect(frames).toEqual([1]);
    // ...and nothing is left drawn once the call finalizes.
    expect(useAiSvgPreviewStore.getState().drafts).toEqual({});
    expect(
      useAiSvgPreviewStore.getState().finalizedKeys.has(svgPreviewKey("s1", "call-1")),
    ).toBe(true);
  });

  it("stages a placeholder before the model has sent anything", async () => {
    // Quiver is silent for ~18s before its first byte. The dashed box has to
    // be on the canvas during that window, not after the first frame.
    let stagedDuringCall: { phase: string; svg: string; bounds: unknown } | null = null;
    streamQuiverVector.mockImplementation(async () => {
      const draft =
        useAiSvgPreviewStore.getState().drafts[svgPreviewKey("s1", "call-1")];
      stagedDuringCall = draft
        ? { phase: draft.phase, svg: draft.svg, bounds: draft.bounds }
        : null;
      return ARTWORK;
    });

    await generateVector({ prompt: "a mark", x: 10, y: 20, width: 160, height: 160 }, CONTEXT);

    expect(stagedDuringCall).not.toBeNull();
    expect(stagedDuringCall!.phase).toBe("waiting");
    // Nothing has been drawn yet, so there is no document to rasterize.
    expect(stagedDuringCall!.svg).toBe("");
    // It must claim the spot the artwork will actually land in.
    expect(stagedDuringCall!.bounds).toEqual({ x: 10, y: 20, width: 160, height: 160 });
  });

  it("does not stage a placeholder without an execution context", async () => {
    streamQuiverVector.mockImplementation(async () => {
      expect(useAiSvgPreviewStore.getState().drafts).toEqual({});
      return ARTWORK;
    });
    const result = JSON.parse(await generateVector({ prompt: "a mark", x: 0, y: 0 }));
    expect(result.success).toBe(true);
  });

  it("clears the preview when generation fails", async () => {
    streamQuiverVector.mockRejectedValue(new Error("Invalid API key"));

    const result = JSON.parse(await generateVector({ prompt: "a mark" }, CONTEXT));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid API key");
    // A staged draft that survives an error path stays painted forever.
    expect(useAiSvgPreviewStore.getState().drafts).toEqual({});
  });

  it("scales the artwork into the requested box", async () => {
    streamQuiverVector.mockResolvedValue(ARTWORK);

    const result = JSON.parse(
      await generateVector(
        { prompt: "a mark", x: 10, y: 20, width: 160, height: 160 },
        CONTEXT,
      ),
    );

    const node = useSceneStore.getState().nodesById[result.createdNode.id];
    expect(node).toBeDefined();
    // The SVG's own viewBox is 80x80; asking for 160 doubles it, so the
    // committed art matches the box the preview was rasterized into.
    expect(node.width).toBeCloseTo(160, 0);
    expect(node.x).toBeCloseTo(10, 0);
  });

  it("works without an execution context (direct MCP call, no preview)", async () => {
    streamQuiverVector.mockResolvedValue(ARTWORK);
    const result = JSON.parse(await generateVector({ prompt: "a mark", x: 0, y: 0 }));
    expect(result.success).toBe(true);
  });

  // Finding 3: width/height "omit to use its natural size" must actually use
  // the SVG's own dimensions, not the DEFAULT_SIZE=240 placeholder.
  it("uses the SVG's own dimensions when width/height are both omitted", async () => {
    streamQuiverVector.mockResolvedValue(ARTWORK);

    const result = JSON.parse(await generateVector({ prompt: "a mark", x: 0, y: 0 }, CONTEXT));

    const node = useSceneStore.getState().nodesById[result.createdNode.id];
    expect(node).toBeDefined();
    // ARTWORK's viewBox is 80x80 — natural size means no scaling at all.
    expect(node.width).toBeCloseTo(80, 0);
    expect(node.height).toBeCloseTo(80, 0);
  });

  // Finding 3: an explicit width/height must still be honored (not
  // overridden by the natural-size path).
  it("still honors an explicit width/height", async () => {
    streamQuiverVector.mockResolvedValue(ARTWORK);

    const result = JSON.parse(
      await generateVector({ prompt: "a mark", x: 0, y: 0, width: 40, height: 40 }, CONTEXT),
    );

    const node = useSceneStore.getState().nodesById[result.createdNode.id];
    expect(node.width).toBeCloseTo(40, 0);
  });

  // Finding 3: a resolving parentId places the artwork as a child of that
  // frame, at coordinates relative to it, instead of the geometric
  // auto-parenting `addDrawnNodeWithAutoParenting` would otherwise do.
  it("places the artwork inside an explicit parentId frame", async () => {
    seedScene(); // frame1 sits at (100, 100), 400x300
    streamQuiverVector.mockResolvedValue(ARTWORK);

    const result = JSON.parse(
      await generateVector(
        { prompt: "a mark", x: 150, y: 160, width: 40, height: 40, parentId: "frame1" },
        CONTEXT,
      ),
    );

    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();
    const node = useSceneStore.getState().nodesById[result.createdNode.id];
    expect(useSceneStore.getState().parentById[result.createdNode.id]).toBe("frame1");
    // bounds.x/y (150,160) minus frame1's own origin (100,100).
    expect(node.x).toBeCloseTo(50, 0);
    expect(node.y).toBeCloseTo(60, 0);
  });

  // Finding 3: a parentId that doesn't resolve to a frame/group must not
  // silently report success as if placement worked as asked.
  it("warns and falls back to automatic placement when parentId doesn't resolve", async () => {
    seedScene();
    streamQuiverVector.mockResolvedValue(ARTWORK);

    const result = JSON.parse(
      await generateVector(
        { prompt: "a mark", x: 0, y: 0, width: 40, height: 40, parentId: "does-not-exist" },
        CONTEXT,
      ),
    );

    expect(result.success).toBe(true);
    expect(result.warnings?.some((w: string) => w.includes("does-not-exist"))).toBe(true);
    // Not parented into anything by name — falls through to geometric
    // auto-parenting/root placement instead.
    expect(useSceneStore.getState().parentById[result.createdNode.id]).not.toBe("does-not-exist");
  });

  // Finding 5: Stop must actually cancel the upstream generation. The
  // handler reads the same AbortController useDesignChat aborts on Stop
  // (`useChatStore.getState().abortControllers[sessionId]`) and threads its
  // signal into `streamQuiverVector`, which previously accepted a `signal`
  // option no caller ever passed.
  it("passes the session's chat AbortController signal to streamQuiverVector", async () => {
    const controller = new AbortController();
    useChatStore.setState({ abortControllers: { s1: controller } });
    streamQuiverVector.mockResolvedValue(ARTWORK);

    await generateVector({ prompt: "a mark", x: 0, y: 0 }, CONTEXT);

    expect(streamQuiverVector.mock.calls[0][0].signal).toBe(controller.signal);

    useChatStore.setState({ abortControllers: {} });
  });

  // Finding 6: an aborted generation must be reported as a cancellation, not
  // a retry-worthy failure, and must not commit any nodes from whatever
  // truncated SVG had streamed in so far.
  it("treats an aborted generation as a cancellation, not an ordinary error", async () => {
    streamQuiverVector.mockRejectedValue(new DOMException("aborted", "AbortError"));
    const before = Object.keys(useSceneStore.getState().nodesById).length;

    const result = JSON.parse(await generateVector({ prompt: "a mark" }, CONTEXT));

    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(Object.keys(useSceneStore.getState().nodesById).length).toBe(before);
  });

  // Finding 10: auto-parenting must not discard the intra-SVG offset baked
  // into node.x/y by scaleAndOffsetNode when the artwork's content doesn't
  // start at its own viewBox origin.
  it("preserves a baked intra-SVG offset when auto-parenting into a frame", async () => {
    seedScene(); // frame1 at (100,100) 400x300 — big enough to contain the art
    // Content starts at (20,20), not (0,0): the group's minX/minY offset
    // (baked into node.x by scaleAndOffsetNode) is nonzero.
    const offsetArt =
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
      '<rect x="20" y="20" width="40" height="40" fill="#FD720D"/>' +
      "</svg>";
    streamQuiverVector.mockResolvedValue(offsetArt);

    const result = JSON.parse(
      await generateVector({ prompt: "a mark", x: 150, y: 160, width: 80, height: 80 }, CONTEXT),
    );

    expect(result.success).toBe(true);
    const node = useSceneStore.getState().nodesById[result.createdNode.id];
    expect(useSceneStore.getState().parentById[result.createdNode.id]).toBe("frame1");
    // Absolute canvas position must be (150+20, 160+20) = (170,180); relative
    // to frame1's origin (100,100) that's (70,80) — NOT (50,60), which is
    // what overwriting with the un-offset bounds.x/y would produce.
    expect(node.x).toBeCloseTo(70, 0);
    expect(node.y).toBeCloseTo(80, 0);
  });
});
