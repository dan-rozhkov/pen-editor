import { describe, it, expect, beforeEach, vi } from "vitest";
import { launchFrameAgentChat } from "../launchFrameAgentChat";
import { useChatStore } from "@/store/chatStore";
import { useSceneStore } from "@/store/sceneStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

// The real screenshot path needs a live PixiJS renderer; stub it.
const mockCapture = vi.fn<(nodeId: string) => Promise<string | null>>();
vi.mock("@/lib/captureNodeScreenshot", () => ({
  captureNodeScreenshot: (nodeId: string) => mockCapture(nodeId),
}));

const FRAME_ID = "frame-1";

beforeEach(() => {
  mockCapture.mockReset();
  mockCapture.mockResolvedValue("data:image/png;base64,SHOT");

  // Reset chat store to a single fresh tab.
  useChatStore.setState({
    tabs: [{ id: "tab-0", title: "Chat 1", model: "m", parallelCount: 1 }],
    activeTabId: "tab-0",
    launchQueue: {},
  });

  // Provide a named frame so the attached image carries the frame's name.
  useSceneStore.setState({
    nodesById: { [FRAME_ID]: { id: FRAME_ID, type: "frame", name: "Home Screen" } },
  } as never);

  useLeftSidebarStore.setState({ activeSection: "pages" });
});

describe("launchFrameAgentChat", () => {
  it("creates a new active tab and queues the typed text as its first message", async () => {
    const ok = await launchFrameAgentChat(FRAME_ID, "  make 3 layouts  ");

    expect(ok).toBe(true);
    const { tabs, activeTabId, launchQueue } = useChatStore.getState();
    // A brand-new tab was created and made active.
    expect(tabs.length).toBe(2);
    expect(activeTabId).not.toBe("tab-0");
    // Trimmed text becomes the queued first message for the new tab.
    expect(launchQueue[activeTabId]?.text).toBe("make 3 layouts");
  });

  it("attaches the frame screenshot (named after the frame) as image context", async () => {
    await launchFrameAgentChat(FRAME_ID, "go");

    expect(mockCapture).toHaveBeenCalledWith(FRAME_ID);
    const { activeTabId, launchQueue } = useChatStore.getState();
    expect(launchQueue[activeTabId]?.images).toEqual([
      { dataUrl: "data:image/png;base64,SHOT", name: "Home Screen" },
    ]);
  });

  it("reveals the Design Agent panel by switching the left section to agents", async () => {
    await launchFrameAgentChat(FRAME_ID, "go");
    expect(useLeftSidebarStore.getState().activeSection).toBe("agents");
  });

  it("opens the sidebar panel so the chat mounts on a collapsed (mobile) layout", async () => {
    // On a narrow viewport LeftSidebar unmounts entirely when isPanelOpen is
    // false, which would strand the queued message; the launch must open it.
    useLeftSidebarStore.setState({ isPanelOpen: false });
    await launchFrameAgentChat(FRAME_ID, "go");
    expect(useLeftSidebarStore.getState().isPanelOpen).toBe(true);
  });

  it("queues a text-only message when the screenshot capture fails", async () => {
    mockCapture.mockResolvedValue(null);
    await launchFrameAgentChat(FRAME_ID, "go");
    const { activeTabId, launchQueue } = useChatStore.getState();
    expect(launchQueue[activeTabId]?.images).toBeUndefined();
    expect(launchQueue[activeTabId]?.text).toBe("go");
  });

  it("is a no-op for empty/whitespace text", async () => {
    const ok = await launchFrameAgentChat(FRAME_ID, "   ");
    expect(ok).toBe(false);
    expect(useChatStore.getState().tabs.length).toBe(1);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(useLeftSidebarStore.getState().activeSection).toBe("pages");
  });
});
