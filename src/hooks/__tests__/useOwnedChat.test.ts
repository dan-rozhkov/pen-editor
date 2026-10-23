import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useChat } from "@ai-sdk/react";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { useOwnedChat } from "@/hooks/useOwnedChat";

/** A transport whose stream stays open; it records each request's abort signal. */
function openStreamTransport() {
  const signals: AbortSignal[] = [];
  const transport: ChatTransport<UIMessage> = {
    sendMessages: async ({ abortSignal }) => {
      if (abortSignal) signals.push(abortSignal);
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.enqueue({ type: "start" });
        },
      });
    },
    reconnectToStream: async () => null,
  };
  return { transport, signals };
}

describe("useOwnedChat", () => {
  it("does not stop the chat on unmount (AI SDK 7 useChat stops chats it creates)", async () => {
    const { transport, signals } = openStreamTransport();
    const { result, unmount } = renderHook(() =>
      useChat({ chat: useOwnedChat({ id: "s1", transport }) })
    );

    act(() => {
      void result.current.sendMessage({ text: "hi" });
    });
    await waitFor(() => expect(signals).toHaveLength(1));

    unmount();

    expect(signals[0].aborted).toBe(false);
  });

  it("keeps one Chat per id and calls the latest transport", async () => {
    const first = openStreamTransport();
    const second = openStreamTransport();
    const { result, rerender } = renderHook(
      ({ transport }) => {
        const owned = useOwnedChat({ id: "s1", transport });
        return { owned, chat: useChat({ chat: owned }) };
      },
      { initialProps: { transport: first.transport } }
    );
    const ownedBefore = result.current.owned;

    rerender({ transport: second.transport });
    act(() => {
      void result.current.chat.sendMessage({ text: "hi" });
    });
    await waitFor(() => expect(second.signals).toHaveLength(1));

    expect(result.current.owned).toBe(ownedBefore);
    expect(first.signals).toHaveLength(0);
  });
});
