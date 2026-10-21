import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedScene, resetStores } from "@/test/fixtures";
import { stubBroadcastChannel } from "@/test/fakeBroadcastChannel";
import { CANVAS_FOCUS_CHANNEL } from "@/lib/docs/canvasFocusRequest";
import { usePageStore } from "@/store/pageStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { startCanvasFocusListener } from "../canvasFocusListener";

const initialPages = usePageStore.getState();
let stop: () => void;
let doc: BroadcastChannel;
let received: unknown[];

beforeEach(() => {
  usePageStore.setState(initialPages, true);
  stubBroadcastChannel();
  resetStores();
  seedScene();
  stop = startCanvasFocusListener();
  doc = new BroadcastChannel(CANVAS_FOCUS_CHANNEL);
  received = [];
  doc.onmessage = (event) => received.push(event.data);
});
afterEach(() => {
  stop();
  doc.close();
  vi.unstubAllGlobals();
});

describe("canvas focus listener", () => {
  it("selects a node it has and acks", () => {
    doc.postMessage({ type: "focus-node", nodeId: "frame1", requestId: "r1" });
    expect(useSelectionStore.getState().selectedIds).toEqual(["frame1"]);
    expect(received).toEqual([{ type: "focus-node-ack", requestId: "r1" }]);
  });

  it("finds a node on another page, switches to it and acks", () => {
    const first = usePageStore.getState().activePageId;
    usePageStore.getState().addPage("Two"); // saves the seeded page, shows an empty one
    expect(usePageStore.getState().activePageId).not.toBe(first);
    expect(useSceneStore.getState().nodesById.frame1).toBeUndefined();
    doc.postMessage({ type: "focus-node", nodeId: "frame1", requestId: "r4" });
    expect(usePageStore.getState().activePageId).toBe(first);
    expect(useSelectionStore.getState().selectedIds).toEqual(["frame1"]);
    expect(received).toEqual([{ type: "focus-node-ack", requestId: "r4" }]);
  });

  it("neither selects nor acks a node it does not have", () => {
    doc.postMessage({ type: "focus-node", nodeId: "nope", requestId: "r2" });
    expect(useSelectionStore.getState().selectedIds).toEqual([]);
    expect(received).toEqual([]);
  });

  it.each([[null], ["text"], [{ type: "focus-node" }], [{ type: "focus-node-ack", requestId: "x" }]])("ignores %j", (data) => {
    doc.postMessage(data);
    expect(received).toEqual([]);
  });

  it("stops answering after cleanup", () => {
    stop();
    doc.postMessage({ type: "focus-node", nodeId: "frame1", requestId: "r3" });
    expect(received).toEqual([]);
  });
});
