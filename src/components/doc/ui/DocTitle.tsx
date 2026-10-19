import { useLayoutEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Enter, or ArrowDown with the caret at the end: hand focus to the editor. */
  onLeave: () => void;
}

/** The page title: a big borderless textarea that grows with its content. */
export function DocTitle({ value, onChange, onLeave }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label="Title"
      placeholder="Untitled"
      value={value}
      spellCheck={false}
      className="text-text-primary placeholder:text-text-muted/50 mb-2 block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[2.5rem] leading-[1.2] font-bold tracking-[-0.02em] outline-none"
      onChange={(event) => onChange(event.target.value.replace(/\n/g, " "))}
      onKeyDown={(event) => {
        const el = event.currentTarget;
        const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
        if (event.key === "Enter" || (event.key === "ArrowDown" && atEnd)) {
          if (event.nativeEvent.isComposing) return;
          event.preventDefault();
          onLeave();
        }
      }}
    />
  );
}
