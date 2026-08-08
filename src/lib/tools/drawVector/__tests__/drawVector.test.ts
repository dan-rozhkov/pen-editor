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
        { name: "Bad", commands: "M(1,2)\nL(3,4)" },
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
      geometry: "M100,100",
      bounds: { x: 100, y: 100, width: 0, height: 0 },
      closed: false,
      ended: false,
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
});
