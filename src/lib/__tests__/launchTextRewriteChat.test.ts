import { describe, it, expect, beforeEach } from "vitest";
import { launchTextRewriteChat } from "../launchTextRewriteChat";
import { TEXT_REWRITE_PRESETS } from "@/lib/textRewritePresets";
import { useChatStore } from "@/store/chatStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

const IMPROVE = TEXT_REWRITE_PRESETS.find((p) => p.id === "improve")!;

beforeEach(() => {
  useChatStore.setState({
    tabs: [{ id: "tab-0", title: "Chat 1", model: "m", agentMode: "prototype", parallelCount: 1 }],
    activeTabId: "tab-0",
    launchQueue: {},
  });
  useLeftSidebarStore.setState({ activeSection: "pages", isPanelOpen: false });
});

describe("launchTextRewriteChat", () => {
  it("creates a new active tab and queues a message naming the target node", () => {
    const ok = launchTextRewriteChat(["text1"], IMPROVE);

    expect(ok).toBe(true);
    const { tabs, activeTabId, launchQueue } = useChatStore.getState();
    expect(tabs.length).toBe(2);
    expect(activeTabId).not.toBe("tab-0");
    expect(launchQueue[activeTabId]?.text).toContain("text1");
    expect(launchQueue[activeTabId]?.text).toContain(IMPROVE.instruction);
  });

  it("references every selected node in a single message for multi-selection", () => {
    launchTextRewriteChat(["text1", "text2"], IMPROVE);
    const { activeTabId, launchQueue } = useChatStore.getState();
    expect(launchQueue[activeTabId]?.text).toContain("text1");
    expect(launchQueue[activeTabId]?.text).toContain("text2");
  });

  it("reveals the Design Agent panel", () => {
    launchTextRewriteChat(["text1"], IMPROVE);
    expect(useLeftSidebarStore.getState().activeSection).toBe("agents");
    expect(useLeftSidebarStore.getState().isPanelOpen).toBe(true);
  });

  it("is a no-op for an empty node list", () => {
    const ok = launchTextRewriteChat([], IMPROVE);
    expect(ok).toBe(false);
    expect(useChatStore.getState().tabs.length).toBe(1);
    expect(useLeftSidebarStore.getState().activeSection).toBe("pages");
  });
});
