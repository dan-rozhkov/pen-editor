import { describe, it, expect, beforeEach, vi } from "vitest";
import { launchFrameAgentChat } from "../launchFrameAgentChat";
import { useChatStore } from "@/store/chatStore";
import { useSceneStore } from "@/store/sceneStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

// The real screenshot path needs a live PixiJS renderer; stub it. It must
// stay unused by launchFrameAgentChat — the frame is selected, so its id
// already rides in canvasContext (see the doc comment on
// launchFrameAgentChat.ts) and no screenshot should ever be captured here.
const mockCapture = vi.fn<(nodeId: string) => Promise<string | null>>();
vi.mock("@/lib/captureNodeScreenshot", () => ({
  captureNodeScreenshot: (nodeId: string) => mockCapture(nodeId),
}));

const FRAME_ID = "frame-1";

beforeEach(() => {
  mockCapture.mockReset();
  mockCapture.mockResolvedValue("data:image/png;base64,SHOT");

  // Reset chat store to a single fresh chat.
  useChatStore.setState({
    chats: [{
      id: "tab-0",
      title: "Chat 1",
      model: "deepseek/deepseek-v4.1-flash",
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
    nodesById: { [FRAME_ID]: { id: FRAME_ID, type: "frame", name: "Home Screen" } },
  } as never);

  useLeftSidebarStore.setState({ activeSection: "pages" });
});

describe("launchFrameAgentChat", () => {
  it("creates a new active chat and queues the typed text as its first message", async () => {
    const ok = await launchFrameAgentChat(FRAME_ID, "  make 3 layouts  ");

    expect(ok).toBe(true);
    const { chats, activeChatId, launchQueue } = useChatStore.getState();
    // A brand-new chat was created and made active.
    expect(chats.length).toBe(2);
    expect(activeChatId).not.toBe("tab-0");
    // Trimmed text becomes the queued first message for the new chat.
    expect(launchQueue[activeChatId!]?.text).toBe("make 3 layouts");
  });

  it("does NOT capture or attach a screenshot — the frame's id already rides in canvasContext", async () => {
    await launchFrameAgentChat(FRAME_ID, "go");

    expect(mockCapture).not.toHaveBeenCalled();
    const { activeChatId, launchQueue } = useChatStore.getState();
    expect(launchQueue[activeChatId!]?.images).toBeUndefined();
    expect(launchQueue[activeChatId!]?.text).toBe("go");
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

  it("is a no-op for empty/whitespace text", async () => {
    const ok = await launchFrameAgentChat(FRAME_ID, "   ");
    expect(ok).toBe(false);
    expect(useChatStore.getState().chats.length).toBe(1);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(useLeftSidebarStore.getState().activeSection).toBe("pages");
  });
});
