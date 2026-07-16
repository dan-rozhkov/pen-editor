import { useState, useEffect, useRef, useCallback } from "react";
import type { UIMessage } from "ai";
import { isToolUIPart } from "ai";
import {
  ImageBrokenIcon,
  ArrowCounterClockwiseIcon,
  CopyIcon,
  CheckIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { PanelEmptyState } from "@/components/PanelEmptyState";
import { messageToMarkdown } from "@/lib/chatExport";
import { SimpleMarkdown } from "./SimpleMarkdown";
import { ToolCallIndicator } from "./ToolCallIndicator";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { ImageLightbox } from "./ImageLightbox";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

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

function MessageCopyButton({ msg }: { msg: UIMessage }) {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => () => clearTimeout(resetTimeoutRef.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(messageToMarkdown(msg));
      setCopied(true);
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write can fail without permission; ignore silently.
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded-lg hover:bg-secondary text-text-muted transition-colors"
            aria-label={copied ? "Copied" : "Copy message"}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </button>
        }
      />
      <TooltipContent>{copied ? "Copied" : "Copy message"}</TooltipContent>
    </Tooltip>
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
        <PanelEmptyState icon={<SparkleIcon size={28} weight="light" />}>
          Ask the design agent anything
        </PanelEmptyState>
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
              <MessageCopyButton msg={msg} />
              {onRollback && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        onClick={() => onRollback(msg.id)}
                        className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded-lg hover:bg-secondary text-text-muted transition-colors"
                        aria-label="Roll back to this message"
                      >
                        <ArrowCounterClockwiseIcon size={14} />
                      </button>
                    }
                  />
                  <TooltipContent>Roll back to this message</TooltipContent>
                </Tooltip>
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
          <div key={msg.id} className="group flex flex-col items-start gap-1">
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
            <div className="ml-2 flex items-center">
              <MessageCopyButton msg={msg} />
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
