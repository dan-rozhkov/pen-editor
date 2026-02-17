import { useState } from "react";
import {
  SpinnerIcon,
  CheckCircleIcon,
  XCircleIcon,
  CaretDownIcon,
} from "@phosphor-icons/react";
import { isToolUIPart, getToolName } from "ai";
import { getToolDisplayName } from "@/lib/toolDisplayNames";

type ToolStatus = "running" | "completed" | "error";

type AnyToolPart = {
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function getToolStatus(part: AnyToolPart): ToolStatus {
  if (part.state === "output-available") return "completed";
  if (part.state === "output-error") return "error";
  return "running";
}

function StatusIcon({ status }: { status: ToolStatus }) {
  switch (status) {
    case "running":
      return <SpinnerIcon size={14} className="animate-spin" />;
    case "completed":
      return (
        <CheckCircleIcon size={14} weight="fill" className="text-green-500" />
      );
    case "error":
      return <XCircleIcon size={14} weight="fill" className="text-red-500" />;
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

function formatJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

interface ToolCallIndicatorProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  part: any;
}

export { isToolUIPart };

export function ToolCallIndicator({ part }: ToolCallIndicatorProps) {
  const [open, setOpen] = useState(false);
  const toolPart = part as AnyToolPart;
  const status = getToolStatus(toolPart);
  const toolName = getToolName(part as Parameters<typeof getToolName>[0]);
  const displayName = getToolDisplayName(toolName);

  return (
    <div className="my-1 px-2 py-1 rounded bg-surface-elevated/60">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full py-0.5 text-xs text-text-muted hover:text-text-secondary"
      >
        <CaretDownIcon
          size={10}
          className={`transition-transform shrink-0 ${open ? "" : "-rotate-90"}`}
        />
        <StatusIcon status={status} />
        <span className="truncate">{displayName}</span>
        <span className="ml-auto text-text-disabled shrink-0">
          {statusText(status)}
        </span>
      </button>
      {open && (
        <div className="ml-5 mt-1 mb-1.5 space-y-1.5 text-xs">
          <div>
            <div className="text-text-disabled text-[10px] uppercase tracking-wider mb-0.5">
              Input
            </div>
            <pre className="p-2 rounded bg-surface-panel font-mono text-[11px] text-text-muted max-h-40 overflow-auto whitespace-pre-wrap break-all">
              {formatJson(toolPart.input)}
            </pre>
          </div>
          <div>
            <div className="text-text-disabled text-[10px] uppercase tracking-wider mb-0.5">
              Output
            </div>
            {status === "running" ? (
              <div className="flex items-center gap-1.5 p-2 rounded bg-surface-panel text-text-disabled">
                <SpinnerIcon size={12} className="animate-spin" />
                Running...
              </div>
            ) : status === "error" ? (
              <pre className="p-2 rounded bg-red-500/10 font-mono text-[11px] text-red-400 max-h-40 overflow-auto whitespace-pre-wrap break-all">
                {toolPart.errorText ?? "Unknown error"}
              </pre>
            ) : (
              <pre className="p-2 rounded bg-surface-panel font-mono text-[11px] text-text-muted max-h-40 overflow-auto whitespace-pre-wrap break-all">
                {formatJson(toolPart.output)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
