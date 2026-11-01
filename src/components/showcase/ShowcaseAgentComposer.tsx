import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

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
      className="sf-composer"
    >
      <label className="sf-composer-field">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Describe your interface concept"
          placeholder="Ask Sideform Agent to create…"
          rows={1}
        />
      </label>
      <button type="submit" disabled={!trimmedPrompt} aria-label="Send" className="sf-composer-send">
        Send
      </button>
    </form>
  );
}
