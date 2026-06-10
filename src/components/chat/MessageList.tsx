import { useState, useEffect, useRef, useCallback } from "react";
import type { UIMessage } from "ai";
import {
  ImageBrokenIcon,
  ArrowCounterClockwiseIcon,
  DownloadSimpleIcon,
} from "@phosphor-icons/react";
import { messageToMarkdown, downloadMarkdown, messageFilename } from "@/lib/chatExport";
import { SimpleMarkdown } from "./SimpleMarkdown";
import { ToolCallIndicator, isToolUIPart } from "./ToolCallIndicator";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { ImageLightbox } from "./ImageLightbox";

interface ImagePreviewProps {
  url: string;
  alt?: string;
  /** Full group of image urls this thumbnail belongs to. Defaults to [url]. */
  urls?: string[];
  /** Index of this thumbnail within the group. Defaults to 0. */
  index?: number;
}

export function ImagePreview({ url, alt, urls, index = 0 }: ImagePreviewProps) {
  const group = urls && urls.length > 0 ? urls : [url];
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <>
      {failed ? (
        <div className="w-[60px] h-[120px] rounded-md bg-surface-panel text-text-muted flex items-center justify-center">
          <ImageBrokenIcon size={18} />
        </div>
      ) : (
        <img
          src={url}
          alt={alt ?? "attached image"}
          onClick={() => setLightboxIndex(index)}
          onError={() => setFailed(true)}
          className="max-w-[120px] max-h-[120px] rounded-md cursor-pointer hover:opacity-80 transition-opacity object-cover"
        />
      )}
      {lightboxIndex !== null && (
        <ImageLightbox
          urls={group}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </>
  );
}

function exportMessage(msg: UIMessage) {
  downloadMarkdown(messageToMarkdown(msg), messageFilename(msg));
}

function MessageExportButton({ msg }: { msg: UIMessage }) {
  return (
    <button
      onClick={() => exportMessage(msg)}
      className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded-lg hover:bg-surface-hover text-text-muted transition-colors"
      title="Export message as Markdown"
    >
      <DownloadSimpleIcon size={14} />
    </button>
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
  onRollback?: (messageId: string) => void;
}

export function MessageList({ messages, isLoading, onRollback }: MessageListProps) {
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
            <div key={msg.id} className="group flex justify-end items-center gap-1">
              <MessageExportButton msg={msg} />
              {onRollback && (
                <button
                  onClick={() => onRollback(msg.id)}
                  className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded-lg hover:bg-surface-hover text-text-muted transition-colors"
                  title="Roll back to this message"
                >
                  <ArrowCounterClockwiseIcon size={14} />
                </button>
              )}
              <div className="max-w-[85%] rounded-xl px-3 py-2 rounded-md bg-secondary text-secondary-foreground transition-colors">
                {imageParts.length > 0 && (
                  <div className="flex gap-2 flex-wrap mb-1">
                    {imageParts.map((p, i) => (
                      <ImagePreview
                        key={i}
                        url={p.url}
                        urls={imageParts.map((part) => part.url)}
                        index={i}
                      />
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
          <div key={msg.id} className="group flex justify-start items-center gap-1">
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
            <MessageExportButton msg={msg} />
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
