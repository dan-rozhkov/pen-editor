import { describe, it, expect, beforeEach } from "vitest";
import { sendCommentToAgent } from "../sendCommentToAgent";
import { useChatStore } from "@/store/chatStore";
import { useCommentsStore } from "@/store/commentsStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

beforeEach(() => {
  useChatStore.setState({
    tabs: [{ id: "tab-0", title: "Chat 1", model: "m", agentMode: "edits", parallelCount: 1 }],
    activeTabId: "tab-0",
    launchQueue: {},
  } as never);
  useLeftSidebarStore.setState({ activeSection: "pages", isPanelOpen: false });
  useCommentsStore.setState({
    threads: [
      {
        id: "t1",
        order: 3,
        anchor: { kind: "canvas", x: 0, y: 0 },
        messages: [{ id: "m1", author: "me", text: "fix", createdAt: 0 }],
      },
    ],
    draftAnchor: null,
    pinsHidden: false,
  });
});

describe("sendCommentToAgent", () => {
  it("queues a chat message referencing the thread's order number and opens the agents panel", () => {
    const ok = sendCommentToAgent("t1");
    expect(ok).toBe(true);

    const { tabs, activeTabId, launchQueue } = useChatStore.getState();
    expect(tabs.length).toBe(2);
    expect(launchQueue[activeTabId]?.text).toContain("#3");

    expect(useLeftSidebarStore.getState().activeSection).toBe("agents");
    expect(useLeftSidebarStore.getState().isPanelOpen).toBe(true);
  });

  it("is a no-op for an unknown thread id", () => {
    const ok = sendCommentToAgent("missing");
    expect(ok).toBe(false);
    expect(useChatStore.getState().tabs.length).toBe(1);
  });
});
