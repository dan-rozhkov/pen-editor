import { describe, it, expect, beforeEach } from "vitest";
import { launchFirstDraftChat } from "../launchFirstDraftChat";
import { useChatStore } from "@/store/chatStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

beforeEach(() => {
  useChatStore.setState({
    tabs: [{ id: "tab-0", title: "Chat 1", model: "m", agentMode: "prototype", parallelCount: 1 }],
    activeTabId: "tab-0",
    launchQueue: {},
  });
  useLeftSidebarStore.setState({ activeSection: "pages", isPanelOpen: false });
});

describe("launchFirstDraftChat", () => {
  it("creates a new active tab and queues a /first-draft message with the description", () => {
    const ok = launchFirstDraftChat("a settings screen with account and notification sections", "mobile");

    expect(ok).toBe(true);
    const { tabs, activeTabId, launchQueue } = useChatStore.getState();
    expect(tabs.length).toBe(2);
    expect(activeTabId).not.toBe("tab-0");
    expect(launchQueue[activeTabId]?.text).toMatch(/^\/first-draft\b/);
    expect(launchQueue[activeTabId]?.text).toContain(
      "a settings screen with account and notification sections",
    );
  });

  it("includes the chosen platform in the dispatched message", () => {
    launchFirstDraftChat("a marketing landing page for a SaaS product", "desktop");
    const { activeTabId, launchQueue } = useChatStore.getState();
    expect(launchQueue[activeTabId]?.text.toLowerCase()).toContain("desktop");
  });

  it("pins the new tab to edits mode so native nodes are used instead of embed-HTML", () => {
    launchFirstDraftChat("a dashboard with a chart and a table", "desktop");
    const { activeTabId, tabs } = useChatStore.getState();
    const tab = tabs.find((t) => t.id === activeTabId);
    expect(tab?.agentMode).toBe("edits");
  });

  it("reveals the Design Agent panel", () => {
    launchFirstDraftChat("a login screen", "mobile");
    expect(useLeftSidebarStore.getState().activeSection).toBe("agents");
    expect(useLeftSidebarStore.getState().isPanelOpen).toBe(true);
  });

  it("is a no-op for an empty description", () => {
    const ok = launchFirstDraftChat("   ", "mobile");
    expect(ok).toBe(false);
    expect(useChatStore.getState().tabs.length).toBe(1);
    expect(useLeftSidebarStore.getState().activeSection).toBe("pages");
  });
});
