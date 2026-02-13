import { useRef, useCallback, useState } from "react";
import { PaperPlaneRightIcon, StopIcon } from "@phosphor-icons/react";
import { useChatStore } from "@/store/chatStore";

export function ChatInput() {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addUserMessage = useChatStore((s) => s.addUserMessage);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setStreaming = useChatStore((s) => s.setStreaming);

  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`;
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    addUserMessage(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, isStreaming, addUserMessage]);

  const handleStop = useCallback(() => {
    setStreaming(false);
  }, [setStreaming]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="border-t border-border-default px-3 py-2">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            resize();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ask the design agent..."
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-disabled outline-none min-h-[24px] max-h-[96px] py-1 leading-normal"
        />
        {isStreaming ? (
          <button
            onClick={handleStop}
            className="shrink-0 p-1.5 rounded-lg hover:bg-surface-hover text-red-500 transition-colors"
            title="Stop"
          >
            <StopIcon size={18} weight="fill" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!value.trim()}
            className="shrink-0 p-1.5 rounded-lg hover:bg-surface-hover text-text-muted disabled:text-text-disabled transition-colors"
            title="Send"
          >
            <PaperPlaneRightIcon size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
