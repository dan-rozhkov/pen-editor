import { useEffect, useRef, useCallback } from "react";
import type { UIMessage, DynamicToolUIPart } from "ai";
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

interface MessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
}

export function MessageList({ messages, isLoading }: MessageListProps) {
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
  }, [messages, isLoading]);

  const lastMessage = messages[messages.length - 1];
  const showTrailingIndicator =
    isLoading && (!lastMessage || lastMessage.role === "user");

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

        const textContent = msg.parts
          .filter(
            (p): p is { type: "text"; text: string } => p.type === "text"
          )
          .map((p) => p.text)
          .join("");

        const toolParts = msg.parts.filter(
          (p): p is DynamicToolUIPart => p.type === "dynamic-tool"
        );
        const hasContent = textContent.length > 0;
        const hasTools = toolParts.length > 0;

        // Show streaming indicator for assistant messages that are empty and still loading
        const isEmptyStreaming =
          isLoading &&
          msg === lastMessage &&
          msg.role === "assistant" &&
          !hasContent &&
          !hasTools;

        return (
          <div
            key={msg.id}
            className={`flex ${isUser ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 ${
                isUser
                  ? "rounded-md bg-secondary text-secondary-foreground transition-colors"
                  : "text-text-primary"
              }`}
            >
              {hasContent && <SimpleMarkdown content={textContent} />}
              {hasTools && <ToolCallIndicator toolParts={toolParts} />}
              {isEmptyStreaming && <StreamingIndicator />}
            </div>
          </div>
        );
      })}

      {showTrailingIndicator && <StreamingIndicator />}
    </div>
  );
}
