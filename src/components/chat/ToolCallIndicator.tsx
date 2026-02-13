import { useState } from "react";
import {
  SpinnerIcon,
  CheckCircleIcon,
  XCircleIcon,
  CaretDownIcon,
} from "@phosphor-icons/react";
import type { ToolCall } from "@/types/chat";

interface ToolCallIndicatorProps {
  toolCalls: ToolCall[];
}

function StatusIcon({ status }: { status: ToolCall["status"] }) {
  switch (status) {
    case "running":
      return <SpinnerIcon size={14} className="animate-spin text-accent-primary" />;
    case "completed":
      return <CheckCircleIcon size={14} weight="fill" className="text-green-500" />;
    case "error":
      return <XCircleIcon size={14} weight="fill" className="text-red-500" />;
  }
}

function statusText(status: ToolCall["status"]): string {
  switch (status) {
    case "running":
      return "Running...";
    case "completed":
      return "Done";
    case "error":
      return "Error";
  }
}

function ToolCallRow({ tc }: { tc: ToolCall }) {
  return (
    <div className="flex items-center gap-1.5 py-0.5 text-xs text-text-muted">
      <StatusIcon status={tc.status} />
      <span className="font-mono truncate">{tc.toolName}</span>
      <span className="ml-auto text-text-disabled shrink-0">
        {statusText(tc.status)}
      </span>
    </div>
  );
}

export function ToolCallIndicator({ toolCalls }: ToolCallIndicatorProps) {
  const [expanded, setExpanded] = useState(false);

  if (toolCalls.length === 0) return null;

  if (toolCalls.length === 1) {
    return (
      <div className="mt-1 px-2 py-1 rounded bg-surface-elevated/60">
        <ToolCallRow tc={toolCalls[0]} />
      </div>
    );
  }

  const running = toolCalls.filter((tc) => tc.status === "running").length;
  const completed = toolCalls.filter((tc) => tc.status === "completed").length;
  const errors = toolCalls.filter((tc) => tc.status === "error").length;

  return (
    <div className="mt-1 px-2 py-1 rounded bg-surface-elevated/60">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-xs text-text-muted hover:text-text-secondary"
      >
        <CaretDownIcon
          size={12}
          className={`transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
        <span>
          {toolCalls.length} tool calls
          {running > 0 && ` (${running} running)`}
          {completed > 0 && ` (${completed} done)`}
          {errors > 0 && ` (${errors} failed)`}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5">
          {toolCalls.map((tc) => (
            <ToolCallRow key={tc.id} tc={tc} />
          ))}
        </div>
      )}
    </div>
  );
}
