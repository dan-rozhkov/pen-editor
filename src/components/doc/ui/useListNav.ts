import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";

export interface SuggestionMenuHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

interface Options<T> {
  items: T[];
  onPick: (item: T) => void;
  /** The highlight returns to the first row when this changes. */
  resetKey: unknown;
  /** False lets every key through to the editor (the user is not choosing). Defaults to "there are rows". */
  picking?: boolean;
}

/**
 * Keyboard list for a suggestion menu: up/down wrap around, Enter/Tab pick the highlighted row.
 * `listRef` goes on the list element so the highlighted row scrolls into view.
 */
export function useListNav<T>(ref: Ref<SuggestionMenuHandle>, { items, onPick, resetKey, picking = items.length > 0 }: Options<T>) {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Back to the first row when the list changes (state adjusted during render, not in an effect).
  const [seenKey, setSeenKey] = useState(resetKey);
  if (!Object.is(seenKey, resetKey)) {
    setSeenKey(resetKey);
    setSelected(0);
  }
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      // Not choosing (nothing to pick yet): every key, the arrows too, belongs to the editor.
      if (items.length === 0 || !picking) return false;
      if (event.key === "ArrowDown") {
        setSelected((selected + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((selected + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        onPick(items[Math.min(selected, items.length - 1)]);
        return true;
      }
      return false;
    },
  }));

  return { selected, setSelected, listRef };
}
