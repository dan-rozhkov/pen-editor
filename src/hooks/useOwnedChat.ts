import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Chat } from "@ai-sdk/react";
import type { ChatInit, ChatTransport, UIMessage } from "ai";
import { takeInitialMessages } from "@/lib/chats/desktopChatPersistence";

export interface OwnedChatOptions {
  id: string;
  transport: ChatTransport<UIMessage>;
  onToolCall?: ChatInit<UIMessage>["onToolCall"];
  onFinish?: ChatInit<UIMessage>["onFinish"];
  sendAutomaticallyWhen?: ChatInit<UIMessage>["sendAutomaticallyWhen"];
}

/**
 * The session's `Chat`, owned here and handed to `useChat({ chat })`.
 *
 * AI SDK 7's `useChat({ id })` calls `chat.stop()` when the component
 * unmounts. A chat session must not be stopped that way: unmount is not a
 * Stop (this hook's own unmount cleanup only blocks auto-continuation), and
 * React StrictMode's dev re-run of effects would abort the first message a
 * launch sends, right after the send drain consumed it. `useChat` never stops
 * an externally managed chat, which is the AI SDK 6 behaviour.
 *
 * The `Chat` is built once per `id`. Like `useChat` does internally, its
 * callbacks and transport go through a ref, so it always calls the closures
 * of the latest render.
 */
export function useOwnedChat(options: OwnedChatOptions): Chat<UIMessage> {
  const latestRef = useRef(options);
  useLayoutEffect(() => {
    latestRef.current = options;
  });
  const getLatest = useCallback(() => latestRef.current, []);
  // Rebuilt only for another session, as `useChat({ id })` did. The Chat
  // constructor stores the callbacks and never calls them, so the ref is not
  // read during render (the same pattern useChat uses internally).
  // eslint-disable-next-line react-hooks/refs
  return useMemo(() => createOwnedChat(options.id, getLatest), [options.id, getLatest]);
}

/** The callbacks call `latest()` only when the Chat calls them, never during render. */
function createOwnedChat(id: string, latest: () => OwnedChatOptions): Chat<UIMessage> {
  return new Chat<UIMessage>({
    id,
    // A chat restored from disk starts with its whole history (undefined for any other chat).
    messages: takeInitialMessages(id),
    transport: {
      get resumeStreamIsReplay() {
        return latest().transport.resumeStreamIsReplay;
      },
      sendMessages: (sendOptions) => latest().transport.sendMessages(sendOptions),
      reconnectToStream: (reconnectOptions) => latest().transport.reconnectToStream(reconnectOptions),
    },
    onToolCall: (arg) => latest().onToolCall?.(arg),
    onFinish: (arg) => latest().onFinish?.(arg),
    sendAutomaticallyWhen: (arg) => latest().sendAutomaticallyWhen?.(arg) ?? false,
  });
}
