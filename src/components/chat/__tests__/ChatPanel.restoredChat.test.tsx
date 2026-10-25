import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { UIMessage } from "ai";

import { ChatPanelContent } from "../ChatPanel";
import { useChatStore, type ChatSummary } from "@/store/chatStore";

const RESTORED: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Plan a coffee app" }] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "Here is a plan." }] },
];

vi.mock("@/lib/chats/desktopChatPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chats/desktopChatPersistence")>();
  return { ...actual, takeInitialMessages: (id: string) => (id === "restored" ? RESTORED : undefined) };
});

function summary(id: string, title: string): ChatSummary {
  return { id, title, model: "deepseek/deepseek-v4.1-flash", parallelCount: 1, titleIsAuto: false, unread: false, needsAnswer: false, isBusy: false, updatedAt: 1000 };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatPanel with a chat restored from disk", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    useChatStore.setState({
      chats: [summary("fresh", "Chat 1"), summary("restored", "Plan a coffee app")],
      activeChatId: "fresh",
      abortControllers: {},
      launchQueue: {},
      sessionActions: {},
    });
  });

  it("does not mark the restored history as a new reply", async () => {
    await act(async () => {
      render(<ChatPanelContent />);
    });
    const restored = useChatStore.getState().chats.find((c) => c.id === "restored");
    expect(restored).toMatchObject({ unread: false, updatedAt: 1000 });
  });
});
