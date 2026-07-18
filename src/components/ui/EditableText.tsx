import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

const DEFAULT_INPUT_CLASSNAME =
  "w-full bg-secondary rounded px-2 py-1 text-xs text-text-primary outline-none";
const DEFAULT_DISPLAY_CLASSNAME =
  "text-xs text-text-secondary truncate cursor-text hover:text-text-primary block px-2 py-1 rounded hover:bg-secondary";

interface EditableTextProps {
  value: string;
  onCommit: (value: string) => void;
  /** Refuse to commit an empty/whitespace-only value (default false = refuse). */
  allowEmpty?: boolean;
  /** What activates edit mode (default "click"). */
  activateOn?: "click" | "doubleClick";
  inputType?: "text" | "number";
  /** Shown when value is empty (default "(empty)"). */
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  /** Parent hook, e.g. PagesPanel disables row drag while editing. */
  onEditingChange?: (editing: boolean) => void;
}

export function EditableText({
  value,
  onCommit,
  allowEmpty = false,
  activateOn = "click",
  inputType = "text",
  placeholder = "(empty)",
  className,
  inputClassName,
  onEditingChange,
}: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = () => {
    setDraft(value);
    setEditing(true);
    onEditingChange?.(true);
  };

  const stopEditing = () => {
    setEditing(false);
    onEditingChange?.(false);
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (!allowEmpty && trimmed === "") {
      stopEditing();
      return;
    }
    if (trimmed !== value) {
      onCommit(trimmed);
    }
    stopEditing();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      commit();
    } else if (e.key === "Escape") {
      setDraft(value);
      stopEditing();
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={inputType}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={clsx(inputClassName ?? DEFAULT_INPUT_CLASSNAME)}
      />
    );
  }

  return (
    <span
      className={clsx(className ?? DEFAULT_DISPLAY_CLASSNAME)}
      onClick={activateOn === "click" ? startEditing : undefined}
      onDoubleClick={activateOn === "doubleClick" ? startEditing : undefined}
    >
      {value || placeholder}
    </span>
  );
}
