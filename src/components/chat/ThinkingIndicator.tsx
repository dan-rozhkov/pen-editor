import { useState, useEffect, useRef } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { SimpleMarkdown } from "./SimpleMarkdown";
import { Shimmer } from "@/components/ai-elements/shimmer";

interface ReasoningPart {
  type: "reasoning";
  text: string;
  state?: string;
}

interface ThinkingIndicatorProps {
  part: ReasoningPart;
}

function useThinkingDuration(isStreaming: boolean) {
  // Initialized lazily in the effect to keep render pure (Date.now() is impure).
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const finalRef = useRef<number | null>(null);

  useEffect(() => {
    if (startRef.current === null) {
      startRef.current = Date.now();
    }
    const start = startRef.current;
    if (!isStreaming) {
      if (finalRef.current === null) {
        finalRef.current = Math.round((Date.now() - start) / 1000);
      }
      setElapsed(finalRef.current);
      return;
    }
    const id = setInterval(() => {
      setElapsed(Math.round((Date.now() - start) / 1000));
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
    <div className="my-0.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full py-0.5 text-[13px] leading-relaxed text-text-muted hover:text-text-secondary"
      >
        {isStreaming ? (
          <Shimmer as="span" className="truncate">
            Thinking...
          </Shimmer>
        ) : (
          <span className="truncate">Thought</span>
        )}
        <span className="text-text-disabled shrink-0">
          {formatDuration(duration)}
        </span>
        <CaretDownIcon
          size={10}
          className={`transition-transform shrink-0 ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && (
        <div className="mt-1 mb-1.5 text-[13px] text-text-muted">
          <SimpleMarkdown content={part.text} />
        </div>
      )}
    </div>
  );
}
