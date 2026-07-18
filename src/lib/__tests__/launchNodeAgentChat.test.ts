import { describe, it, expect, beforeEach, vi } from "vitest";
import { launchNodeAgentChat } from "../launchNodeAgentChat";
import { useChatStore } from "@/store/chatStore";
import { useSceneStore } from "@/store/sceneStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

const mockCapture = vi.fn<(nodeId: string) => Promise<string | null>>();
vi.mock("@/lib/captureNodeScreenshot", () => ({
  captureNodeScreenshot: (nodeId: string) => mockCapture(nodeId),
}));

const NODE_ID = "node-1";

beforeEach(() => {
  mockCapture.mockReset();
  mockCapture.mockResolvedValue("data:image/png;base64,SHOT");
  useChatStore.setState({
    tabs: [{ id: "tab-0", title: "Chat 1", model: "m", parallelCount: 1 }],
    activeTabId: "tab-0",
    launchQueue: {},
  });
  useSceneStore.setState({
    nodesById: { [NODE_ID]: { id: NODE_ID, type: "embed", name: "Card" } },
  } as never);
  useLeftSidebarStore.setState({ activeSection: "pages", isPanelOpen: false });
});

describe("launchNodeAgentChat", () => {
  it("creates a new active tab and queues the trimmed text", async () => {
    const ok = await launchNodeAgentChat(NODE_ID, "  hello  ");
    expect(ok).toBe(true);
    const { tabs, activeTabId, launchQueue } = useChatStore.getState();
    expect(tabs.length).toBe(2);
    expect(activeTabId).not.toBe("tab-0");
    expect(launchQueue[activeTabId]?.text).toBe("hello");
  });

  it("attaches the screenshot by default", async () => {
    await launchNodeAgentChat(NODE_ID, "go");
    expect(mockCapture).toHaveBeenCalledWith(NODE_ID);
    const { activeTabId, launchQueue } = useChatStore.getState();
    expect(launchQueue[activeTabId]?.images).toEqual([
      { dataUrl: "data:image/png;base64,SHOT", name: "Card" },
    ]);
  });

  it("skips the screenshot when attachScreenshot is false", async () => {
    await launchNodeAgentChat(NODE_ID, "go", { attachScreenshot: false });
    expect(mockCapture).not.toHaveBeenCalled();
    const { activeTabId, launchQueue } = useChatStore.getState();
    expect(launchQueue[activeTabId]?.images).toBeUndefined();
  });

  it("reveals and opens the agents panel", async () => {
    await launchNodeAgentChat(NODE_ID, "go", { attachScreenshot: false });
    expect(useLeftSidebarStore.getState().activeSection).toBe("agents");
    expect(useLeftSidebarStore.getState().isPanelOpen).toBe(true);
  });

  it("is a no-op for empty/whitespace text", async () => {
    const ok = await launchNodeAgentChat(NODE_ID, "   ");
    expect(ok).toBe(false);
    expect(useChatStore.getState().tabs.length).toBe(1);
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
