import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowsOutSimple, ArrowsInSimple, ArrowSquareOut, Sidebar, SidebarSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { CanvasContextMenu } from "@/components/canvas/CanvasContextMenu";
import { PrimitivesPanel } from "@/components/PrimitivesPanel";
import { RightSidebar } from "@/components/RightSidebar";
import { ReadOnlyProvider } from "@/components/ReadOnlyProvider";
import { PixiCanvas } from "@/pixi/PixiCanvas";
import { useMcpBridgeStore } from "@/store/mcpBridgeStore";
import { setUIThemeTransient } from "@/store/uiThemeStore";
import { LeftRail } from "@/components/LeftRail";
import { LeftSidebarBase } from "@/components/LeftSidebarBase";
import type { LeftSection } from "@/store/leftSidebarStore";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { HostBridge } from "./hostBridge";
import { resolveApiUrl } from "@/lib/apiBase";
import { openInSideform } from "./openInSideform";

// The Agents chat is not part of the widget. The Components panel (its actions
// mutate the scene) and the design lint (automatic re-checks and bulk fixes are
// an editor workflow) are left out too: the widget is a slim, host-sized canvas.
const HIDDEN_SECTIONS: readonly LeftSection[] = ["agents", "components", "lint"];

function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

const SHARE_RETRY_MS = 8_000;
const NO_API_MESSAGE = "Sharing is unavailable: this build has no backend URL configured.";

// Editor shell for the MCP Apps widget: the real canvas, layers and
// properties panels, nothing else (no router, chat, showcase, auth, PWA,
// analytics, WebMCP or desktop bridge). The host theme styles this top bar
// only — the design canvas is never themed by the host.
export function EmbedApp({ host }: { host: HostBridge | null }) {
  const isMobile = useIsMobile();
  const status = useMcpBridgeStore((s) => s.status);
  const [layersOpen, setLayersOpen] = useState(() => window.innerWidth >= 1000);
  const [propsOpen, setPropsOpen] = useState(true);
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  // A same-origin (empty) API base would hit the host sandbox, never the backend.
  const apiMissing = resolveApiUrl("") === "";

  const hostTheme = useSyncExternalStore(
    (cb) => host?.onContextChange(cb) ?? (() => {}),
    () => host?.getTheme(),
  );
  // The host's theme drives the whole editor chrome (the app's own `.dark`
  // class mechanism) for this session only — never saved as the user's
  // preference. No host theme: follow the OS.
  const appliedTheme = hostTheme ?? (prefersDark() ? "dark" : "light");
  useEffect(() => {
    setUIThemeTransient(appliedTheme);
  }, [appliedTheme]);
  const displayMode = useSyncExternalStore(
    (cb) => host?.onContextChange(cb) ?? (() => {}),
    () => host?.getDisplayMode() ?? "inline",
  );

  useEffect(() => {
    if (!shareError) return;
    const timer = setTimeout(() => setShareError(null), SHARE_RETRY_MS);
    return () => clearTimeout(timer);
  }, [shareError]);

  const onShare = async () => {
    if (!host || sharing) return;
    setSharing(true);
    const result = await openInSideform((url) => host.openLink(url));
    setSharing(false);
    if (!result.ok) setShareError(result.error);
  };

  const dark = appliedTheme === "dark";
  const chrome = dark ? "bg-[#1f1f1f] text-[#ededed] border-[#333]" : "bg-white text-[#1a1a1a] border-[#e4e4e4]";
  const statusLabel = status === "connected" ? "Agent connected" : status === "connecting" ? "Connecting…" : "Not connected";
  const statusDot = status === "connected" ? "bg-green-500" : status === "connecting" ? "bg-amber-400" : "bg-neutral-400";

  return (
    <TooltipProvider delay={400} closeDelay={0}>
      <div className="w-full h-full flex flex-col overflow-hidden" data-testid="embed-root">
        <div className={`h-9 shrink-0 flex items-center gap-1 px-2 border-b text-xs ${chrome}`} data-testid="embed-topbar" data-theme={appliedTheme}>
          <span className="font-medium pr-1">Sideform</span>
          <span className="flex items-center gap-1.5 text-[11px] opacity-80" role="status" aria-label={statusLabel}>
            <span className={`size-1.5 rounded-full ${statusDot}`} />
            {statusLabel}
          </span>
          <div className="flex-1" />
          <Button variant="ghost" size="icon-sm" aria-label="Toggle layers" aria-pressed={layersOpen} onClick={() => setLayersOpen((v) => !v)}>
            <SidebarSimple size={14} />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Toggle properties" aria-pressed={propsOpen} onClick={() => setPropsOpen((v) => !v)}>
            <Sidebar size={14} mirrored />
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <span tabIndex={0}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!host || sharing || shareError !== null || apiMissing}
                    onClick={onShare}
                  >
                    <ArrowSquareOut size={14} />
                    Open in Sideform
                  </Button>
                </span>
              }
            />
            <TooltipContent side="bottom">{apiMissing ? NO_API_MESSAGE : (shareError ?? "Share this canvas and open it in Sideform")}</TooltipContent>
          </Tooltip>
          {host?.canExpand() && (
            <Button variant="ghost" size="sm" onClick={() => void host.toggleFullscreen()}>
              {displayMode === "fullscreen" ? <ArrowsInSimple size={14} /> : <ArrowsOutSimple size={14} />}
              {displayMode === "fullscreen" ? "Collapse" : "Expand"}
            </Button>
          )}
        </div>
        <div className="flex-1 min-h-0 relative flex flex-row">
          <LeftRail hiddenSections={HIDDEN_SECTIONS} />
          <ReadOnlyProvider value={false}>
            {(layersOpen || isMobile) && <LeftSidebarBase hiddenSections={HIDDEN_SECTIONS} />}
          </ReadOnlyProvider>
          <div className="flex-1 min-w-0 relative">
            <div className="absolute inset-0 isolate">
              <CanvasContextMenu>
                <PixiCanvas />
              </CanvasContextMenu>
            </div>
            <div className="absolute inset-0 pointer-events-none">
              <div className="pointer-events-auto">
                <PrimitivesPanel />
              </div>
            </div>
          </div>
          {propsOpen && (
            <ReadOnlyProvider value={false}>
              <RightSidebar />
            </ReadOnlyProvider>
          )}
        </div>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
