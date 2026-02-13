import { useRef, useCallback } from "react";
import { PaperPlaneRightIcon, StopIcon } from "@phosphor-icons/react";

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  stop: () => void;
}

export function ChatInput({
  input,
  setInput,
  onSubmit,
  isLoading,
  stop,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`;
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (input.trim() && !isLoading) {
          onSubmit(e as unknown as React.FormEvent);
        }
      }
    },
    [input, isLoading, onSubmit]
  );

  return (
    <form
      onSubmit={onSubmit}
      className="border-t border-border-default px-3 py-2"
    >
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            resize();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ask the design agent..."
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-disabled outline-none min-h-[24px] max-h-[96px] py-1 leading-normal"
        />
        {isLoading ? (
          <button
            type="button"
            onClick={stop}
            className="shrink-0 p-1.5 rounded-lg hover:bg-surface-hover text-text-muted transition-colors"
            title="Stop"
          >
            <StopIcon size={18} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="shrink-0 p-1.5 rounded-lg hover:bg-surface-hover text-text-muted disabled:text-text-disabled transition-colors"
            title="Send"
          >
            <PaperPlaneRightIcon size={18} />
          </button>
        )}
      </div>
    </form>
  );
}
