import { useState } from "react";
import {
  ArrowSquareOutIcon,
  ArrowsOutSimpleIcon,
  CaretDownIcon,
  CaretUpIcon,
  GlobeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { releaseCloudBrowser } from "@/lib/cloudBrowser";
import { CloudBrowserLiveView } from "./CloudBrowserLiveView";
import { useBrowserSurfaceChatId } from "@/hooks/useBrowserSurfaceChat";
import { useCloudBrowserStore } from "@/store/cloudBrowserStore";
import { useSurfaceStore } from "@/store/surfaceStore";
import { useCanSwitchSurfaces, useEffectiveSurfaceId } from "@/surfaces/effectiveSurface";
import { isDesktopBrowserAvailable } from "@/lib/tools/browser/bridge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Live view of the agent's cloud browser (pen-editor-backend docs/specs/
 * 2026-09-29-cloud-browser-steel-design.md §4). Shows only while this chat has
 * a live cloud session; the desktop shell has its own built-in browser tab,
 * so it renders nothing there.
 */
export function CloudBrowserPanel({ chatId }: { chatId: string }) {
  const session = useCloudBrowserStore((s) => s.sessions[chatId]);
  const [collapsed, setCollapsed] = useState(false);
  const setActiveSurface = useSurfaceStore((s) => s.setActiveSurface);
  // Where the main area really shows the browser (not merely requested), and
  // for which chat: only that chat's panel gives up its iframe.
  const canSwitch = useCanSwitchSurfaces();
  const shownChatId = useBrowserSurfaceChatId();
  const inMainArea = useEffectiveSurfaceId() === "browser" && shownChatId === chatId;

  if (isDesktopBrowserAvailable() || !session) return null;

  // One live view per Steel session: while the main area shows it, this panel
  // keeps no iframe of its own, only a way back.
  if (inMainArea) {
    return (
      <section
        aria-label="Cloud browser"
        className="mx-3 mt-2 flex shrink-0 items-center gap-1.5 rounded-xl border border-border-default bg-surface-panel px-2.5 py-1.5 text-text-muted"
      >
        <GlobeIcon size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">Shown in main area</span>
        <Button variant="ghost" size="sm" onClick={() => setActiveSurface("canvas")}>
          Show here
        </Button>
      </section>
    );
  }

  return (
    <section
      aria-label="Cloud browser"
      className="mx-3 mt-2 shrink-0 overflow-hidden rounded-xl border border-border-default bg-surface-panel"
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-text-muted">
        <GlobeIcon size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">Browser</span>
        {canSwitch && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open in main area"
                  onClick={() => setActiveSurface("browser", { chatId })}
                >
                  <ArrowsOutSimpleIcon />
                </Button>
              }
            />
            <TooltipContent>Open in main area</TooltipContent>
          </Tooltip>
        )}
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
        <CloudBrowserLiveView
          session={session}
          className="block aspect-[16/10] w-full border-0 border-t border-border-default bg-white"
        />
      )}
    </section>
  );
}
