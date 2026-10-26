import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { DotsThreeVerticalIcon, DownloadSimpleIcon, FileCodeIcon, FileTextIcon } from "@/components/icons";
import { memo } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/IconButton";
import { useDownloadTrace, useOpenResult, usePlaywrightSpec } from "./useTraceActions";

/** The one-off actions of the trace header in one overflow menu (like the /workflow and /doc options menus). Progress and failures are toasts. */
export const TraceActionsMenu = memo(function TraceActionsMenu({ trace, cloudTraceId }: { trace: BrowseTrace; cloudTraceId?: string }) {
  const result = useOpenResult(trace);
  const { busy, download } = useDownloadTrace(trace, cloudTraceId);
  const playwright = usePlaywrightSpec(trace);
  return (
    <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton variant="ghost" size="icon" tooltip="Trace options">
              <DotsThreeVerticalIcon className="size-4" weight="light" />
            </IconButton>
          }
        />
        <DropdownMenuContent align="end" sideOffset={4} className="min-w-48 whitespace-nowrap">
          {result.available && (
            <DropdownMenuItem onClick={result.open}>
              <FileTextIcon weight="light" /> Open result
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={busy} onClick={() => void download()}>
            <DownloadSimpleIcon weight="light" /> Download trace
          </DropdownMenuItem>
          {playwright.available && (
            <DropdownMenuItem onClick={playwright.download}>
              <FileCodeIcon weight="light" /> Download Playwright test{" "}
              {playwright.notes && <span className="ml-auto pl-3 text-xs text-text-muted">{playwright.notes}</span>}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
    </DropdownMenu>
  );
});
