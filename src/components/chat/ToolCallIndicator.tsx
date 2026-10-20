import { createElement, useContext, useMemo, useState } from "react";
import {
  CaretDownIcon,
  DownloadSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { getToolName } from "ai";
import { getToolDisplayName } from "@/lib/toolDisplayNames";
import { getToolIcon } from "@/lib/toolIcons";
import { browseToolHint } from "@/lib/tools/browser/browseToolHint";
import { downloadFile, filenameFromUrl } from "@/lib/downloadFile";
import { extractImageRefs } from "./extractImageUrls";
import { LikeReferenceButton, type LikeMeta } from "./LikeReferenceButton";
import { ImagePreview } from "./MessageList";
import { ChatSessionIdContext } from "./ChatSessionContext";
import { revealToolTab } from "@/lib/canvasLink/revealToolTab";
import { useChatStore } from "@/store/chatStore";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { CHEVRON_WEIGHT } from "@/components/ui/chevron";

type ToolStatus = "running" | "completed" | "error";

type AnyToolPart = {
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/**
 * Tool failures are stored as ordinary `output-available` parts whose output
 * is `{"error": ...}` (a JSON string from handlers/harness, or an object).
 * Returns the error message, or undefined for a normal output.
 */
function errorFromToolOutput(output: unknown): string | undefined {
  if (typeof output === "string") {
    if (!output.trimStart().startsWith('{"error"')) return undefined;
    try {
      const parsed: unknown = JSON.parse(output);
      const e = parsed && typeof parsed === "object" ? (parsed as { error?: unknown }).error : undefined;
      // Valid JSON: an error only with a non-empty string `error` (`{"error":null,...}` is a result).
      return typeof e === "string" && e !== "" ? e : undefined;
    } catch {
      return output; // malformed JSON: still an error, show the raw text
    }
  }
  if (output && typeof output === "object") {
    const e = (output as { error?: unknown }).error;
    if (typeof e === "string" && e !== "") return e;
  }
  return undefined;
}

function getToolStatus(part: AnyToolPart): ToolStatus {
  if (part.state === "output-available") {
    return errorFromToolOutput(part.output) !== undefined ? "error" : "completed";
  }
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
  /** Replaces the status word ("Running...", "Done", "Error"). Used by BrowseAgentIndicator. */
  statusLabel?: string;
  /** Shows the error cross instead of the tool icon even when the call completed. */
  statusError?: boolean;
  /** Panes shown in the expanded block, before Input. */
  extraPanes?: Array<{ label: string; content: string }>;
  /** Short muted text between the name and the status. Defaults to browseToolHint. */
  hint?: string;
  /** Replaces the raw tool input in the expandable Input pane (e.g. a redacted copy). */
  inputForDisplay?: unknown;
}

export function ToolCallIndicator({ part, statusLabel, statusError, extraPanes, hint, inputForDisplay }: ToolCallIndicatorProps) {
  const [open, setOpen] = useState(false);
  const contextSessionId = useContext(ChatSessionIdContext);
  const toolPart = part as AnyToolPart;
  const status = getToolStatus(toolPart);
  const toolName = getToolName(part as Parameters<typeof getToolName>[0]);
  const displayName = getToolDisplayName(toolName);
  const isError = status === "error" || statusError === true;
  const shownHint = hint ?? browseToolHint(toolName, toolPart.input);
  const output = toolPart.output;
  const imageRefs = useMemo(
    () => (status === "completed" ? extractImageRefs(output) : []),
    [status, output],
  );
  const imageUrls = useMemo(() => imageRefs.map((r) => r.url), [imageRefs]);
  const likeMeta = useMemo(() => {
    const meta: Record<string, LikeMeta> = {};
    for (const r of imageRefs) meta[r.url] = { sourceUrl: r.sourceUrl, tool: toolName };
    return meta;
  }, [imageRefs, toolName]);

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
        onClick={() => {
          // In the desktop agent panel the chip also brings forward the tab its call runs in.
          void revealToolTab({
            sessionId: contextSessionId ?? useChatStore.getState().activeChatId,
            toolCallId: toolPart.toolCallId,
            toolName,
            input: toolPart.input,
          });
          setOpen(!open);
        }}
        className="flex items-center gap-1.5 w-full py-0.5 text-[13px] leading-relaxed text-text-muted hover:text-text-secondary"
      >
        {/* Per-tool icon, so a chip is recognisable before its label is read.
            There is no separate status icon: "Running..."/"Done"/"Error" says
            it in words. On an error the row stays muted and the icon becomes
            a cross. */}
        {isError ? (
          <XIcon size={14} className="shrink-0" data-testid="tool-error-icon" />
        ) : (
          <ToolIcon name={toolName} className="shrink-0" />
        )}
        {status === "running" ? (
          <Shimmer as="span" className="truncate">
            {displayName}
          </Shimmer>
        ) : (
          <span className="truncate">{displayName}</span>
        )}
        {shownHint && <span className="truncate min-w-0 shrink-[999] text-text-disabled">{shownHint}</span>}
        <span
          className="shrink-0 text-text-disabled"
        >
          {status === "running" ? (
            <Shimmer as="span">{statusLabel ?? statusText(status)}</Shimmer>
          ) : (
            (statusLabel ?? statusText(status))
          )}
        </span>
        <CaretDownIcon
          size={10}
          className={`transition-transform duration-250 ease-smooth-out shrink-0 ${open ? "" : "-rotate-90"}`}
          weight={CHEVRON_WEIGHT}
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
                <ImagePreview url={url} urls={imageUrls} index={i} likeMeta={likeMeta} />
                <LikeReferenceButton url={url} {...likeMeta[url]} />
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
          {extraPanes?.map((pane) => (
            <div key={pane.label}>
              <div className="text-text-disabled text-[10px] uppercase tracking-wider mb-0.5">
                {pane.label}
              </div>
              <pre className="p-2 rounded bg-surface-elevated font-mono text-[11px] text-text-muted max-h-40 overflow-auto whitespace-pre-wrap break-all">
                {pane.content}
              </pre>
            </div>
          ))}
          <div>
            <div className="text-text-disabled text-[10px] uppercase tracking-wider mb-0.5">
              Input
            </div>
            <pre className="p-2 rounded bg-surface-elevated font-mono text-[11px] text-text-muted max-h-40 overflow-auto whitespace-pre-wrap break-all">
              {formatJson(inputForDisplay !== undefined ? inputForDisplay : toolPart.input)}
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
                {toolPart.errorText ??
                  errorFromToolOutput(toolPart.output) ??
                  "Unknown error"}
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
