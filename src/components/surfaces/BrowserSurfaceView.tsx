import { DesktopIcon, GlobeIcon } from "@phosphor-icons/react";
import { PanelEmptyState } from "@/components/PanelEmptyState";
import { CloudBrowserLiveView } from "@/components/chat/CloudBrowserLiveView";
import { useBrowserSurfaceChatId } from "@/hooks/useBrowserSurfaceChat";
import { isDesktopBrowserAvailable } from "@/lib/tools/browser/bridge";
import { useCloudBrowserStore } from "@/store/cloudBrowserStore";

/**
 * Main-area view of the browser surface. App.tsx mounts it above the canvas
 * layer (which stays mounted underneath) and below the app chrome.
 */
export function BrowserSurfaceView() {
  const chatId = useBrowserSurfaceChatId();
  const session = useCloudBrowserStore((s) => (chatId ? s.sessions[chatId] : undefined));

  let body;
  if (isDesktopBrowserAvailable()) {
    body = (
      <PanelEmptyState icon={<DesktopIcon size={24} />}>
        The browser runs in a tab of the desktop app.
      </PanelEmptyState>
    );
  } else if (session) {
    body = (
      <CloudBrowserLiveView session={session} className="block size-full border-0 bg-white" />
    );
  } else {
    body = (
      <PanelEmptyState icon={<GlobeIcon size={24} />}>
        The agent opens a browser here when a task needs one.
      </PanelEmptyState>
    );
  }

  return (
    <section
      aria-label="Browser"
      data-testid="browser-surface-view"
      className="absolute inset-0 bg-surface-panel pointer-events-auto"
    >
      {body}
    </section>
  );
}
