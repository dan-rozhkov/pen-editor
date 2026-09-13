import { beforeEach, describe, expect, it } from "vitest";

import { launchShowcaseAgentChat } from "@/lib/launchShowcaseAgentChat";
import {
  consumeShowcaseAgentPrompt,
  storeShowcaseAgentPrompt,
} from "@/lib/showcaseAgentHandoff";
import { useChatStore } from "@/store/chatStore";
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

beforeEach(() => {
  sessionStorage.clear();
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
    parallelCount: 1,
    launchQueue: {},
  });
  useLeftSidebarStore.setState({
    activeSection: "pages",
    isPanelOpen: false,
  });
});

describe("launchShowcaseAgentChat", () => {
  it("consumes the handoff into a new chat and reveals the agents panel", () => {
    storeShowcaseAgentPrompt("  make a travel app  ");

    expect(launchShowcaseAgentChat()).toBe(true);

    const chat = useChatStore.getState();
    expect(chat.chats).toHaveLength(2);
    expect(chat.activeChatId).not.toBe("tab-0");
    expect(chat.launchQueue[chat.activeChatId!]?.text).toBe("make a travel app");
    expect(useLeftSidebarStore.getState().activeSection).toBe("agents");
    expect(useLeftSidebarStore.getState().isPanelOpen).toBe(true);
    expect(consumeShowcaseAgentPrompt()).toBeNull();
  });

  it("does nothing when there is no showcase handoff", () => {
    expect(launchShowcaseAgentChat()).toBe(false);

    expect(useChatStore.getState().chats).toHaveLength(1);
    expect(useChatStore.getState().launchQueue).toEqual({});
    expect(useLeftSidebarStore.getState().activeSection).toBe("pages");
    expect(useLeftSidebarStore.getState().isPanelOpen).toBe(false);
  });
});
