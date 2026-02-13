import { useState } from "react";
import {
  SpinnerIcon,
  CheckCircleIcon,
  XCircleIcon,
  CaretDownIcon,
} from "@phosphor-icons/react";
import type { DynamicToolUIPart } from "ai";

type ToolStatus = "running" | "completed" | "error";

function getToolStatus(part: DynamicToolUIPart): ToolStatus {
  if (part.state === "output-available") return "completed";
  if (part.state === "output-error") return "error";
  return "running";
}

interface ToolCallIndicatorProps {
  toolParts: DynamicToolUIPart[];
}

function StatusIcon({ status }: { status: ToolStatus }) {
  switch (status) {
    case "running":
      return (
        <SpinnerIcon size={14} className="animate-spin text-accent-primary" />
      );
    case "completed":
      return (
        <CheckCircleIcon
          size={14}
          weight="fill"
          className="text-green-500"
        />
      );
    case "error":
      return (
        <XCircleIcon size={14} weight="fill" className="text-red-500" />
      );
  }
}

function statusText(status: ToolStatus): string {
  switch (status) {
    case "running":
      return "Running...";
    case "completed":
      return "Done";
    case "error":
      return "Error";
  }
}

function ToolCallRow({ part }: { part: DynamicToolUIPart }) {
  const status = getToolStatus(part);
  return (
    <div className="flex items-center gap-1.5 py-0.5 text-xs text-text-muted">
      <StatusIcon status={status} />
      <span className="font-mono truncate">{part.toolName}</span>
      <span className="ml-auto text-text-disabled shrink-0">
        {statusText(status)}
      </span>
    </div>
  );
}

export function ToolCallIndicator({ toolParts }: ToolCallIndicatorProps) {
  const [expanded, setExpanded] = useState(false);

  if (toolParts.length === 0) return null;

  if (toolParts.length === 1) {
    return (
      <div className="mt-1 px-2 py-1 rounded bg-surface-elevated/60">
        <ToolCallRow part={toolParts[0]} />
      </div>
    );
  }

  const running = toolParts.filter(
    (p) => getToolStatus(p) === "running"
  ).length;
  const completed = toolParts.filter(
    (p) => getToolStatus(p) === "completed"
  ).length;
  const errors = toolParts.filter(
    (p) => getToolStatus(p) === "error"
  ).length;

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
          {toolParts.length} tool calls
          {running > 0 && ` (${running} running)`}
          {completed > 0 && ` (${completed} done)`}
          {errors > 0 && ` (${errors} failed)`}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5">
          {toolParts.map((part) => (
            <ToolCallRow key={part.toolCallId} part={part} />
          ))}
        </div>
      )}
    </div>
  );
}
