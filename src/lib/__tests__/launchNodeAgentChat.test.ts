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
    chats: [{
      id: "tab-0",
      title: "Chat 1",
      parallelCount: 1,
      titleIsAuto: true,
      unread: false,
      needsAnswer: false,
      isBusy: false,
      updatedAt: 0,
    }],
    activeChatId: "tab-0",
    launchQueue: {},
  });
  useSceneStore.setState({
    nodesById: { [NODE_ID]: { id: NODE_ID, type: "embed", name: "Card" } },
  } as never);
  useLeftSidebarStore.setState({ activeSection: "pages", isPanelOpen: false });
});

describe("launchNodeAgentChat", () => {
  it("creates a new active chat and queues the trimmed text", async () => {
    const ok = await launchNodeAgentChat(NODE_ID, "  hello  ");
    expect(ok).toBe(true);
    const { chats, activeChatId, launchQueue } = useChatStore.getState();
    expect(chats.length).toBe(2);
    expect(activeChatId).not.toBe("tab-0");
    expect(launchQueue[activeChatId!]?.text).toBe("hello");
  });

  it("attaches the screenshot by default", async () => {
    await launchNodeAgentChat(NODE_ID, "go");
    expect(mockCapture).toHaveBeenCalledWith(NODE_ID);
    const { activeChatId, launchQueue } = useChatStore.getState();
    expect(launchQueue[activeChatId!]?.images).toEqual([
      { dataUrl: "data:image/png;base64,SHOT", name: "Card" },
    ]);
  });

  it("skips the screenshot when attachScreenshot is false", async () => {
    await launchNodeAgentChat(NODE_ID, "go", { attachScreenshot: false });
    expect(mockCapture).not.toHaveBeenCalled();
    const { activeChatId, launchQueue } = useChatStore.getState();
    expect(launchQueue[activeChatId!]?.images).toBeUndefined();
  });

  it("reveals and opens the agents panel", async () => {
    await launchNodeAgentChat(NODE_ID, "go", { attachScreenshot: false });
    expect(useLeftSidebarStore.getState().activeSection).toBe("agents");
    expect(useLeftSidebarStore.getState().isPanelOpen).toBe(true);
  });

  it("is a no-op for empty/whitespace text", async () => {
    const ok = await launchNodeAgentChat(NODE_ID, "   ");
    expect(ok).toBe(false);
    expect(useChatStore.getState().chats.length).toBe(1);
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
