import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUpIcon } from "@phosphor-icons/react";

interface ShowcaseAgentComposerProps {
  onSubmit: (prompt: string) => void;
}

export function ShowcaseAgentComposer({
  onSubmit,
}: ShowcaseAgentComposerProps) {
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmedPrompt = prompt.trim();

  function submitPrompt() {
    if (!trimmedPrompt) return;
    onSubmit(trimmedPrompt);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitPrompt();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submitPrompt();
  }

  return (
    <form
      onSubmit={handleSubmit}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("button")) return;
        textareaRef.current?.focus();
      }}
      className="mx-auto mt-6 max-w-xl overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-colors focus-within:border-accent-light"
    >
      <textarea
        ref={textareaRef}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask the design agent to create…"
        rows={1}
        className="block min-h-14 w-full resize-none bg-transparent px-4 pt-3 text-sm leading-6 text-text-primary outline-none placeholder:text-text-disabled"
      />
      <div className="flex justify-end px-2 pb-2">
        <button
          type="submit"
          disabled={!trimmedPrompt}
          aria-label="Send"
          className={
            trimmedPrompt
              ? "inline-flex size-[30px] shrink-0 items-center justify-center rounded-full bg-accent-primary text-white transition-colors hover:bg-accent-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
              : "inline-flex size-[30px] shrink-0 items-center justify-center rounded-full border border-border-default bg-transparent text-text-muted opacity-60"
          }
        >
          <ArrowUpIcon size={18} weight="regular" />
        </button>
      </div>
    </form>
  );
}
