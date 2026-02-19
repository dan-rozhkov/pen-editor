import { useState, useEffect, useRef } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { SimpleMarkdown } from "./SimpleMarkdown";

interface ReasoningPart {
  type: "reasoning";
  text: string;
  state?: string;
}

interface ThinkingIndicatorProps {
  part: ReasoningPart;
}

function useThinkingDuration(isStreaming: boolean) {
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const finalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      if (finalRef.current === null) {
        finalRef.current = Math.round((Date.now() - startRef.current) / 1000);
      }
      setElapsed(finalRef.current);
      return;
    }
    const id = setInterval(() => {
      setElapsed(Math.round((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  return elapsed;
}

function formatDuration(seconds: number): string {
  if (seconds < 1) return "less 1s";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function ThinkingIndicator({ part }: ThinkingIndicatorProps) {
  const [open, setOpen] = useState(false);
  const isStreaming = part.state === "streaming";
  const duration = useThinkingDuration(isStreaming);

  return (
    <div className="my-2 px-2 py-1 rounded bg-surface-elevated/60">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full py-0.5 text-xs text-text-muted hover:text-text-secondary"
      >
        <CaretDownIcon
          size={10}
          className={`transition-transform shrink-0 ${open ? "" : "-rotate-90"}`}
        />
        <span className="truncate">
          {isStreaming ? "Thinking..." : "Thought"}
        </span>
        <span className="ml-auto text-text-disabled shrink-0">
          {formatDuration(duration)}
        </span>
      </button>
      {open && (
        <div className="ml-5 mt-1 mb-1.5 text-xs text-text-muted">
          <SimpleMarkdown content={part.text} />
        </div>
      )}
    </div>
  );
}
