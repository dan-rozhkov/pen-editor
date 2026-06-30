import { describe, it, expect, beforeEach, vi } from "vitest";
import { launchEmbedAgentChat } from "../launchEmbedAgentChat";
import { useChatStore } from "@/store/chatStore";
import { useSceneStore } from "@/store/sceneStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

const mockCapture = vi.fn<(nodeId: string) => Promise<string | null>>();
vi.mock("@/lib/captureNodeScreenshot", () => ({
  captureNodeScreenshot: (nodeId: string) => mockCapture(nodeId),
}));

const EMBED_ID = "embed-1";

beforeEach(() => {
  mockCapture.mockReset();
  mockCapture.mockResolvedValue("data:image/png;base64,SHOT");
  useChatStore.setState({
    tabs: [{ id: "tab-0", title: "Chat 1", model: "m", agentMode: "prototype", parallelCount: 1 }],
    activeTabId: "tab-0",
    launchQueue: {},
  });
  useSceneStore.setState({
    nodesById: { [EMBED_ID]: { id: EMBED_ID, type: "embed", name: "Card" } },
  } as never);
  useLeftSidebarStore.setState({ activeSection: "pages", isPanelOpen: false });
});

describe("launchEmbedAgentChat", () => {
  it("queues the message without attaching a screenshot", async () => {
    const ok = await launchEmbedAgentChat(EMBED_ID, "  improve it  ");
    expect(ok).toBe(true);
    expect(mockCapture).not.toHaveBeenCalled();
    const { activeTabId, launchQueue } = useChatStore.getState();
    expect(launchQueue[activeTabId]?.text).toBe("improve it");
    expect(launchQueue[activeTabId]?.images).toBeUndefined();
  });

  it("forwards the agent mode", async () => {
    await launchEmbedAgentChat(EMBED_ID, "find refs", "research");
    const { tabs, activeTabId } = useChatStore.getState();
    expect(tabs.find((t) => t.id === activeTabId)?.agentMode).toBe("research");
  });

  it("is a no-op for empty text", async () => {
    const ok = await launchEmbedAgentChat(EMBED_ID, "   ");
    expect(ok).toBe(false);
    expect(useChatStore.getState().tabs.length).toBe(1);
  });
});
