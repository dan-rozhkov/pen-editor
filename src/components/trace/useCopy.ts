import { useCallback, useEffect, useRef, useState } from "react";
import { writeTextToClipboard } from "@/utils/clipboard";

/** Copies text; `copied` stays true for a moment after a success. The timer is cleared on unmount. */
export function useCopy(): [copied: boolean, copy: (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback((text: string) => {
    void writeTextToClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    });
  }, []);
  return [copied, copy];
}
