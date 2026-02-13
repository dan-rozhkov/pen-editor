import { useEffect, useRef, useCallback } from "react";
import { useChatStore } from "@/store/chatStore";
import { SimpleMarkdown } from "./SimpleMarkdown";
import { ToolCallIndicator } from "./ToolCallIndicator";

function StreamingIndicator() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);

  const containerRef = useRef<HTMLDivElement>(null);
  const isAutoScrollRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    isAutoScrollRef.current = atBottom;
  }, []);

  useEffect(() => {
    if (!isAutoScrollRef.current) return;
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, isStreaming]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto layers-scrollbar px-3 py-3 space-y-3"
    >
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm gap-2">
          <span className="text-2xl">&#x2728;</span>
          <p>Ask the design agent anything</p>
        </div>
      )}

      {messages.map((msg) => {
        const isUser = msg.role === "user";
        const isCurrentStreaming =
          isStreaming && msg.id === streamingMessageId;

        return (
          <div
            key={msg.id}
            className={`flex ${isUser ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 ${
                isUser
                  ? "bg-accent-primary text-white"
                  : "bg-surface-elevated text-text-primary"
              }`}
            >
              <SimpleMarkdown content={msg.content} />
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <ToolCallIndicator toolCalls={msg.toolCalls} />
              )}
              {isCurrentStreaming && !msg.content && <StreamingIndicator />}
            </div>
          </div>
        );
      })}

      {isStreaming && !streamingMessageId && <StreamingIndicator />}
    </div>
  );
}
