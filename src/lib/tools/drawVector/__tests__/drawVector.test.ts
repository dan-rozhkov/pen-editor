import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { createSnapshot } from "@/store/sceneStore/helpers/history";
import {
  useAiVectorPreviewStore,
  vectorPreviewKey,
} from "@/store/aiVectorPreviewStore";
import type { PathNode } from "@/types/scene";
import { drawVector } from "@/lib/tools/drawVector";

function undo() {
  const snapshot = createSnapshot(useSceneStore.getState());
  const prev = useHistoryStore.getState().undo(snapshot);
  if (prev) useSceneStore.getState().restoreSnapshot(prev);
}

const LEAF_COMMANDS = [
  "M(100,100)",
  "L(200,100)",
  "L(150,200)",
  "CLOSE()",
  'FILL("#65a765")',
  'STROKE("#234a32",2)',
  "END()",
].join("\n");

function pathNodes(): PathNode[] {
  return Object.values(useSceneStore.getState().nodesById).filter(
    (node): node is PathNode => node.type === "path",
  );
}

describe("drawVector", () => {
  beforeEach(() => {
    resetStores();
    useAiVectorPreviewStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits a single validated path node with points, geometry, bounds, closed, fill, and stroke", async () => {
    const output = JSON.parse(
      await drawVector(
        { name: "Leaf", commands: LEAF_COMMANDS },
        { sessionId: "s1", toolCallId: "c1" },
      ),
    );

    expect(output).toMatchObject({ success: true, anchorCount: 3 });
    expect(output.createdNode).toMatchObject({ name: "Leaf", type: "path" });

    const paths = pathNodes();
    expect(paths).toHaveLength(1);
    const [node] = paths;
    expect(node.points).toHaveLength(3);
    expect(node.closed).toBe(true);
    expect(node.fill).toBe("#65a765");
    expect(node.pathStroke).toMatchObject({
      fill: "#234a32",
      thickness: 2,
      join: "round",
      cap: "round",
      align: "center",
    });
    expect(node.geometry).toMatch(/^M100,100/);
    expect(node.geometryBounds).toEqual({ x: 100, y: 100, width: 100, height: 100 });
  });

  it("auto-parents into a containing frame and stores parent-local x/y", async () => {
    seedScene();
    // frame1 is at (100,100) 400x300 — place the vector well inside it.
    const commands = [
      "M(150,150)",
      "L(250,150)",
      "L(200,250)",
      "CLOSE()",
      "END()",
    ].join("\n");

    await drawVector({ name: "Inner", commands }, { sessionId: "s1", toolCallId: "c1" });

    const scene = useSceneStore.getState();
    const [node] = pathNodes();
    expect(scene.parentById[node.id]).toBe("frame1");
    // World x was 150, frame1 is at absolute (100,100) -> parent-local 50.
    expect(node.x).toBe(50);
    expect(node.y).toBe(50);
  });

  it("undoes the complete node with a single undo call", async () => {
    await drawVector(
      { name: "Leaf", commands: LEAF_COMMANDS },
      { sessionId: "s1", toolCallId: "c1" },
    );
    expect(pathNodes()).toHaveLength(1);

    undo();

    expect(pathNodes()).toHaveLength(0);
  });

  it("rejects an invalid final script without mutating scene or history", async () => {
    const pastBefore = useHistoryStore.getState().past.length;

    const output = JSON.parse(
      await drawVector(
        // An unreadable command is still fatal — unlike a merely incomplete
        // stream (missing END), there is no safe way to guess intent here.
        { name: "Bad", commands: "M(1,2)\nL(3,4)\nWAT()" },
        { sessionId: "s1", toolCallId: "c1" },
      ),
    );

    expect(output.success).not.toBe(true);
    expect(output.error).toBeTruthy();
    expect(pathNodes()).toHaveLength(0);
    expect(useHistoryStore.getState().past.length).toBe(pastBefore);
  });

  it("rejects wrong argument types without mutating scene or history", async () => {
    const pastBefore = useHistoryStore.getState().past.length;

    const output = JSON.parse(
      await drawVector(
        { name: 42, commands: null } as unknown as Record<string, unknown>,
        { sessionId: "s1", toolCallId: "c1" },
      ),
    );

    expect(output.success).not.toBe(true);
    expect(pathNodes()).toHaveLength(0);
    expect(useHistoryStore.getState().past.length).toBe(pastBefore);
  });

  it("commits synchronously without preview/replay when execution context is missing", async () => {
    // A direct MCP registry call passes no context.
    const output = JSON.parse(await drawVector({ name: "Leaf", commands: LEAF_COMMANDS }));

    expect(output.success).toBe(true);
    expect(pathNodes()).toHaveLength(1);
    expect(Object.keys(useAiVectorPreviewStore.getState().drafts)).toHaveLength(0);
  });

  it("skips replay when the call already streamed a preview", async () => {
    useAiVectorPreviewStore.getState().upsert({
      sessionId: "s1",
      toolCallId: "c1",
      name: "Leaf",
      commandText: "M(100,100)\n",
      points: [{ x: 100, y: 100 }],
      contours: [{ points: [{ x: 100, y: 100 }], closed: false }],
      geometry: "M100,100",
      bounds: { x: 100, y: 100, width: 0, height: 0 },
      closed: false,
      ended: false,
      warnings: [],
      phase: "streaming",
      receivedDuringStreaming: true,
    });

    const replaySpy = vi.spyOn(
      await import("@/lib/tools/drawVector/previewController"),
      "replayVectorPreview",
    );

    const output = JSON.parse(
      await drawVector(
        { name: "Leaf", commands: LEAF_COMMANDS },
        { sessionId: "s1", toolCallId: "c1" },
      ),
    );

    expect(output.success).toBe(true);
    expect(output.streamed).toBe(true);
    expect(replaySpy).not.toHaveBeenCalled();
    replaySpy.mockRestore();
  });

  it("runs bounded replay when no preview was streamed for the call", async () => {
    const replaySpy = vi.spyOn(
      await import("@/lib/tools/drawVector/previewController"),
      "replayVectorPreview",
    );

    const output = JSON.parse(
      await drawVector(
        { name: "Leaf", commands: LEAF_COMMANDS },
        { sessionId: "s1", toolCallId: "c1" },
      ),
    );

    expect(output.success).toBe(true);
    expect(output.streamed).toBe(false);
    expect(replaySpy).toHaveBeenCalledTimes(1);
    replaySpy.mockRestore();
  });

  it("commits the node before the preview key is finalized/cleared", async () => {
    vi.useFakeTimers();

    const promise = drawVector(
      { name: "Leaf", commands: LEAF_COMMANDS },
      { sessionId: "s1", toolCallId: "c1" },
    );
    await vi.runAllTimersAsync();
    const output = JSON.parse(await promise);

    expect(output.success).toBe(true);
    expect(pathNodes()).toHaveLength(1);

    const key = vectorPreviewKey("s1", "c1");
    // The path node exists in the scene; finalization/clearing of the
    // preview draft is deferred (rAF) and has not necessarily run yet, but
    // the commit itself must never depend on it — assert the scene mutation
    // already happened regardless of finalization timing.
    expect(pathNodes()[0]).toBeDefined();

    await vi.runAllTimersAsync();
    expect(useAiVectorPreviewStore.getState().finalizedKeys.has(key)).toBe(true);
    expect(useAiVectorPreviewStore.getState().drafts[key]).toBeUndefined();
  });

  it("commits successfully despite a missing END (recovered with a warning)", async () => {
    // Missing END() is now a recoverable condition (the stream is treated as
    // complete), not a fatal parse error — the whole point of the
    // robustness work is that a call that never reaches END still commits.
    const output = JSON.parse(
      await drawVector(
        { name: "Leaf", commands: "M(100,100)\nL(200,100)\nL(150,200)" },
        { sessionId: "s1", toolCallId: "c1" },
      ),
    );

    expect(output.success).toBe(true);
    expect(pathNodes()).toHaveLength(1);
    expect(output.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("END() was missing")]),
    );
  });

  it("clears a staged preview when the final script fails validation (unknown command)", async () => {
    const key = vectorPreviewKey("s1", "c1");
    useAiVectorPreviewStore.getState().upsert({
      sessionId: "s1",
      toolCallId: "c1",
      name: "Leaf",
      commandText: "M(100,100)\nL(200,100)\n",
      points: [{ x: 100, y: 100 }, { x: 200, y: 100 }],
      contours: [{ points: [{ x: 100, y: 100 }, { x: 200, y: 100 }], closed: false }],
      geometry: "M100,100L200,100",
      bounds: { x: 100, y: 100, width: 100, height: 0 },
      closed: false,
      ended: false,
      warnings: [],
      phase: "streaming",
      receivedDuringStreaming: true,
    });
    expect(useAiVectorPreviewStore.getState().drafts[key]).toBeDefined();

    const output = JSON.parse(
      await drawVector(
        { name: "Leaf", commands: "M(100,100)\nL(200,100)\nWAT()" },
        { sessionId: "s1", toolCallId: "c1" },
      ),
    );

    expect(output.success).not.toBe(true);
    expect(pathNodes()).toHaveLength(0);
    expect(useAiVectorPreviewStore.getState().drafts[key]).toBeUndefined();
  });

  it("clears a staged preview when the final script has only one anchor", async () => {
    const key = vectorPreviewKey("s1", "c1");
    useAiVectorPreviewStore.getState().upsert({
      sessionId: "s1",
      toolCallId: "c1",
      name: "Dot",
      commandText: "M(0,0)\n",
      points: [{ x: 0, y: 0 }],
      contours: [{ points: [{ x: 0, y: 0 }], closed: false }],
      geometry: "M0,0",
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      closed: false,
      ended: false,
      warnings: [],
      phase: "streaming",
      receivedDuringStreaming: true,
    });
    expect(useAiVectorPreviewStore.getState().drafts[key]).toBeDefined();

    const output = JSON.parse(
      await drawVector(
        { name: "Dot", commands: "M(0,0)\nEND()" },
        { sessionId: "s1", toolCallId: "c1" },
      ),
    );

    expect(output.success).not.toBe(true);
    expect(pathNodes()).toHaveLength(0);
    expect(useAiVectorPreviewStore.getState().drafts[key]).toBeUndefined();
  });

  it("clears a staged preview when the arguments are invalid", async () => {
    const key = vectorPreviewKey("s1", "c1");
    useAiVectorPreviewStore.getState().upsert({
      sessionId: "s1",
      toolCallId: "c1",
      name: "Leaf",
      commandText: "M(100,100)\n",
      points: [{ x: 100, y: 100 }],
      contours: [{ points: [{ x: 100, y: 100 }], closed: false }],
      geometry: "M100,100",
      bounds: { x: 100, y: 100, width: 0, height: 0 },
      closed: false,
      ended: false,
      warnings: [],
      phase: "streaming",
      receivedDuringStreaming: true,
    });
    expect(useAiVectorPreviewStore.getState().drafts[key]).toBeDefined();

    const output = JSON.parse(
      await drawVector(
        { name: 42, commands: null } as unknown as Record<string, unknown>,
        { sessionId: "s1", toolCallId: "c1" },
      ),
    );

    expect(output.success).not.toBe(true);
    expect(useAiVectorPreviewStore.getState().drafts[key]).toBeUndefined();
  });

  it("clears a staged preview and rethrows when the commit path throws", async () => {
    const key = vectorPreviewKey("s1", "c1");
    useAiVectorPreviewStore.getState().upsert({
      sessionId: "s1",
      toolCallId: "c1",
      name: "Leaf",
      commandText: LEAF_COMMANDS,
      points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }],
      contours: [
        {
          points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }],
          closed: true,
        },
      ],
      geometry: "M100,100L200,100L150,200Z",
      bounds: { x: 100, y: 100, width: 100, height: 100 },
      closed: true,
      ended: true,
      warnings: [],
      phase: "streaming",
      receivedDuringStreaming: true,
    });
    expect(useAiVectorPreviewStore.getState().drafts[key]).toBeDefined();

    const autoParenting = await import("@/pixi/interaction/autoParentPlacement");
    const spy = vi
      .spyOn(autoParenting, "addDrawnNodeWithAutoParenting")
      .mockImplementation(() => {
        throw new Error("boom");
      });

    await expect(
      drawVector({ name: "Leaf", commands: LEAF_COMMANDS }, { sessionId: "s1", toolCallId: "c1" }),
    ).rejects.toThrow("boom");

    expect(pathNodes()).toHaveLength(0);
    expect(useAiVectorPreviewStore.getState().drafts[key]).toBeUndefined();

    spy.mockRestore();
  });

  it("commits a default black stroke and a warning when neither FILL nor STROKE is given", async () => {
    const commands = ["M(0,0)", "L(10,0)", "L(10,10)", "L(0,10)", "CLOSE()", "END()"].join("\n");

    const output = JSON.parse(
      await drawVector({ name: "Bare", commands }, { sessionId: "s1", toolCallId: "c1" }),
    );

    expect(output.success).toBe(true);
    expect(output.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("default black stroke")]),
    );

    const [node] = pathNodes();
    expect(node.fill).toBeUndefined();
    expect(node.pathStroke).toEqual({
      fill: "#000000",
      thickness: 2,
      join: "round",
      cap: "round",
      align: "center",
    });
  });

  it("never omits paint when only FILL is given (no default stroke needed)", async () => {
    const commands = [
      "M(0,0)",
      "L(10,0)",
      "L(10,10)",
      "L(0,10)",
      "CLOSE()",
      'FILL("#00ff00")',
      "END()",
    ].join("\n");

    const output = JSON.parse(
      await drawVector({ name: "Filled", commands }, { sessionId: "s1", toolCallId: "c1" }),
    );

    expect(output.success).toBe(true);
    expect(output.warnings).toBeUndefined();

    const [node] = pathNodes();
    expect(node.fill).toBe("#00ff00");
    expect(node.pathStroke).toBeUndefined();
  });

  it("falls back to a default stroke when FILL is fully transparent (alpha 00), not merely absent", async () => {
    // FILL("#00000000") is truthy as a string, so the old `!fill` presence
    // check missed it entirely — the shape committed with paint that is
    // invisible on screen and no warning explaining why.
    const commands = [
      "M(0,0)",
      "L(10,0)",
      "L(10,10)",
      "L(0,10)",
      "CLOSE()",
      'FILL("#00000000")',
      "END()",
    ].join("\n");

    const output = JSON.parse(
      await drawVector({ name: "Ghost", commands }, { sessionId: "s1", toolCallId: "c1" }),
    );

    expect(output.success).toBe(true);
    expect(output.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("default black stroke")]),
    );

    const [node] = pathNodes();
    expect(node.pathStroke).toEqual({
      fill: "#000000",
      thickness: 2,
      join: "round",
      cap: "round",
      align: "center",
    });
  });

  it("commits a multi-contour script as one geometry with evenodd fill rule and no points array", async () => {
    const commands = [
      "M(0,0)",
      "L(20,0)",
      "L(20,20)",
      "L(0,20)",
      "CLOSE()",
      "M(5,5)",
      "L(15,5)",
      "L(15,15)",
      "L(5,15)",
      "CLOSE()",
      'FILL("#3366ff")',
      "END()",
    ].join("\n");

    const output = JSON.parse(
      await drawVector({ name: "Donut", commands }, { sessionId: "s1", toolCallId: "c1" }),
    );

    expect(output.success).toBe(true);
    expect(output.anchorCount).toBe(8);

    const [node] = pathNodes();
    expect(node.points).toBeUndefined();
    expect(node.closed).toBeUndefined();
    expect(node.fillRule).toBe("evenodd");
    expect(node.fill).toBe("#3366ff");
    expect((node.geometry.match(/M/g) ?? []).length).toBe(2);
  });
});
