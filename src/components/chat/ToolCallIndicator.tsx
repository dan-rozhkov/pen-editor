import { createElement, useState } from "react";
import {
  CaretDownIcon,
  DownloadSimpleIcon,
} from "@phosphor-icons/react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { getToolName } from "ai";
import { getToolDisplayName } from "@/lib/toolDisplayNames";
import { getToolIcon } from "@/lib/toolIcons";
import { downloadFile, filenameFromUrl } from "@/lib/downloadFile";
import { extractImageUrls } from "./extractImageUrls";
import { ImagePreview } from "./MessageList";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

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

// The icon component is looked up by name, so it is resolved here rather than
// in ToolCallIndicator's body — assigning a component to a capitalized local
// during render is what the react-compiler lint rule forbids.
function ToolIcon({ name, className }: { name: string; className?: string }) {
  return createElement(getToolIcon(name), { size: 14, className });
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

export function ToolCallIndicator({ part }: ToolCallIndicatorProps) {
  const [open, setOpen] = useState(false);
  const toolPart = part as AnyToolPart;
  const status = getToolStatus(toolPart);
  const toolName = getToolName(part as Parameters<typeof getToolName>[0]);
  const displayName = getToolDisplayName(toolName);
  const imageUrls = status === "completed" ? extractImageUrls(toolPart.output) : [];

  const downloadOne = (url: string, index: number) =>
    downloadFile(url, filenameFromUrl(url, index));

  const downloadAll = async () => {
    for (let i = 0; i < imageUrls.length; i++) {
      await downloadOne(imageUrls[i], i + 1);
      if (i < imageUrls.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  };

  return (
    <div className="my-0.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full py-0.5 text-[13px] leading-relaxed text-text-muted hover:text-text-secondary"
      >
        {/* Per-tool icon, so a chip is recognisable before its label is read.
            There is no separate status icon: "Running..."/"Done"/"Error" says
            it in words, and on an error this icon turns red. */}
        <ToolIcon
          name={toolName}
          className={`shrink-0 ${status === "error" ? "text-red-500" : ""}`}
        />
        {status === "running" ? (
          <Shimmer as="span" className="truncate">
            {displayName}
          </Shimmer>
        ) : (
          <span className="truncate">{displayName}</span>
        )}
        <span
          className={`shrink-0 ${status === "error" ? "text-red-500" : "text-text-disabled"}`}
        >
          {status === "running" ? (
            <Shimmer as="span">{statusText(status)}</Shimmer>
          ) : (
            statusText(status)
          )}
        </span>
        <CaretDownIcon
          size={10}
          className={`transition-transform shrink-0 ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {status === "completed" && imageUrls.length > 0 && (
        <div className="mt-1.5 mb-1.5">
          {imageUrls.length >= 2 && (
            <button
              onClick={() => void downloadAll()}
              className="mb-1.5 flex items-center gap-1 text-[13px] text-text-muted hover:text-text-secondary"
            >
              <DownloadSimpleIcon size={12} />
              Download all
            </button>
          )}
          <div className="flex gap-1.5 overflow-x-auto overflow-y-hidden pb-1 layers-scrollbar">
            {imageUrls.map((url, i) => (
              <div key={url} className="shrink-0 relative group">
                <ImagePreview url={url} urls={imageUrls} index={i} />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void downloadOne(url, i + 1);
                        }}
                        aria-label="Download image"
                        className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-black/80 transition-opacity"
                      >
                        <DownloadSimpleIcon size={12} />
                      </button>
                    }
                  />
                  <TooltipContent>Download image</TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        </div>
      )}
      {open && (
        <div className="mt-1 mb-1.5 space-y-1.5 text-[13px]">
          <div>
            <div className="text-text-disabled text-[10px] uppercase tracking-wider mb-0.5">
              Input
            </div>
            <pre className="p-2 rounded bg-surface-elevated font-mono text-[11px] text-text-muted max-h-40 overflow-auto whitespace-pre-wrap break-all">
              {formatJson(toolPart.input)}
            </pre>
          </div>
          <div>
            <div className="text-text-disabled text-[10px] uppercase tracking-wider mb-0.5">
              Output
            </div>
            {status === "running" ? (
              <div className="p-2 rounded bg-surface-elevated">
                <Shimmer as="span">Running...</Shimmer>
              </div>
            ) : status === "error" ? (
              <pre className="p-2 rounded bg-red-500/10 font-mono text-[11px] text-red-400 max-h-40 overflow-auto whitespace-pre-wrap break-all">
                {toolPart.errorText ?? "Unknown error"}
              </pre>
            ) : (
              <>
                <pre className="p-2 rounded bg-surface-elevated font-mono text-[11px] text-text-muted max-h-40 overflow-auto whitespace-pre-wrap break-all">
                  {formatJson(toolPart.output)}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
