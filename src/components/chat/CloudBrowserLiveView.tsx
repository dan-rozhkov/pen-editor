import type { CloudBrowserSession } from "@/store/cloudBrowserStore";

/** The live-view iframe of a cloud browser session, shared by the chat panel and the main-area surface. */
export function CloudBrowserLiveView({
  session,
  className,
}: {
  session: CloudBrowserSession;
  className?: string;
}) {
  return (
    <iframe
      title="Cloud browser live view"
      src={session.liveViewUrl}
      sandbox="allow-scripts allow-same-origin"
      className={className}
    />
  );
}
