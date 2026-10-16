import { useEffect, useState } from "react";
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretUpIcon,
  GlobeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { getSessionStaleAt, useCloudBrowserStore } from "@/store/cloudBrowserStore";
import { expireCloudBrowser, releaseCloudBrowser } from "@/lib/cloudBrowser";
import { isDesktopBrowserAvailable } from "@/lib/tools/browser/bridge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Live view of the agent's cloud browser (pen-editor-backend docs/specs/
 * 2026-09-29-cloud-browser-steel-design.md §4). Shows only while this chat has
 * a live cloud session; the desktop shell has its own built-in browser tab,
 * so it renders nothing there.
 */
export function CloudBrowserPanel({ chatId }: { chatId: string }) {
  const session = useCloudBrowserStore((s) => s.sessions[chatId]);
  const [collapsed, setCollapsed] = useState(false);

  // One timer set to the moment the backend will have dropped the session
  // (min of hard expiry and last use + idle timeout); it re-arms itself
  // because setTimeout cannot represent delays past ~24.8 days.
  useEffect(() => {
    if (!session) return;
    const staleAt = getSessionStaleAt(session);
    if (staleAt === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const remaining = staleAt - Date.now();
      if (remaining <= 0) {
        expireCloudBrowser(chatId);
        return;
      }
      timer = setTimeout(arm, Math.min(remaining, MAX_TIMER_MS));
    };
    arm();
    return () => clearTimeout(timer);
  }, [session, chatId]);

  if (isDesktopBrowserAvailable() || !session) return null;

  return (
    <section
      aria-label="Cloud browser"
      className="mx-3 mt-2 shrink-0 overflow-hidden rounded-xl border border-border-default bg-surface-panel"
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-text-muted">
        <GlobeIcon size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">Browser</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                nativeButton={false}
                aria-label="Open in new tab"
                render={
                  <a href={session.liveViewUrl} target="_blank" rel="noopener noreferrer" />
                }
              >
                <ArrowSquareOutIcon />
              </Button>
            }
          />
          <TooltipContent>Open in new tab</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close browser"
                onClick={() => void releaseCloudBrowser(chatId)}
              >
                <XIcon />
              </Button>
            }
          />
          <TooltipContent>Close browser</TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={collapsed ? "Expand browser view" : "Collapse browser view"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? <CaretDownIcon /> : <CaretUpIcon />}
        </Button>
      </div>
      {!collapsed && (
        <iframe
          title="Cloud browser live view"
          src={session.liveViewUrl}
          sandbox="allow-scripts allow-same-origin"
          className="block aspect-[16/10] w-full border-0 border-t border-border-default bg-white"
        />
      )}
    </section>
  );
}
