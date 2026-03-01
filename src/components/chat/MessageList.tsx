import { useState, useEffect, useRef, useCallback } from "react";
import type { UIMessage } from "ai";
import { SimpleMarkdown } from "./SimpleMarkdown";
import { ToolCallIndicator, isToolUIPart } from "./ToolCallIndicator";
import { ThinkingIndicator } from "./ThinkingIndicator";

export function ImagePreview({ url, alt }: { url: string; alt?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <img
        src={url}
        alt={alt ?? "attached image"}
        onClick={() => setExpanded(true)}
        className="max-w-[120px] max-h-[120px] rounded-md cursor-pointer hover:opacity-80 transition-opacity object-cover"
      />
      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setExpanded(false)}
        >
          <img
            src={url}
            alt={alt ?? "attached image"}
            className="max-w-[90vw] max-h-[90vh] rounded-lg"
          />
        </div>
      )}
    </>
  );
}

function StreamingIndicator() {
  return (
    <div className="h-5 flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1 h-1 rounded-full bg-text-muted animate-bounce"
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

        if (isUser) {
          const textContent = msg.parts
            .filter(
              (p): p is { type: "text"; text: string } => p.type === "text"
            )
            .map((p) => p.text)
            .join("");

          const imageParts = msg.parts.filter(
            (p): p is { type: "file"; mediaType: string; url: string } => {
              if (p.type !== "file") return false;
              const fp = p as { mediaType?: string };
              return typeof fp.mediaType === "string" && fp.mediaType.startsWith("image/");
            }
          );

          return (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-xl px-3 py-2 rounded-md bg-secondary text-secondary-foreground transition-colors">
                {imageParts.length > 0 && (
                  <div className="flex gap-2 flex-wrap mb-1">
                    {imageParts.map((p, i) => (
                      <ImagePreview key={i} url={p.url} />
                    ))}
                  </div>
                )}
                {textContent && <SimpleMarkdown content={textContent} />}
              </div>
            </div>
          );
        }

        // Assistant: render parts inline in order
        const hasAnyContent = msg.parts.some(
          (p) => (p.type === "text" && p.text) || p.type === "reasoning" || isToolUIPart(p)
        );
        const isEmptyStreaming =
          isLoading &&
          msg === lastMessage &&
          !hasAnyContent;

        return (
          <div key={msg.id} className="flex justify-start">
            <div className="max-w-[85%] rounded-xl px-3 py-2 text-text-primary">
              {msg.parts.map((part, i) => {
                if (part.type === "text" && part.text) {
                  return <SimpleMarkdown key={i} content={part.text} />;
                }
                if (part.type === "reasoning" && part.text) {
                  return <ThinkingIndicator key={`reasoning-${i}`} part={part} />;
                }
                if (isToolUIPart(part)) {
                  const tp = part as { toolCallId: string };
                  return (
                    <ToolCallIndicator key={tp.toolCallId} part={part} />
                  );
                }
                return null;
              })}
              {isEmptyStreaming && <StreamingIndicator />}
            </div>
          </div>
        );
      })}

      {showTrailingIndicator && (
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-xl px-3 py-2 text-text-primary">
            <StreamingIndicator />
          </div>
        </div>
      )}
    </div>
  );
}
