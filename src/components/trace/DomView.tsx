import type { BrowseTraceDom } from "@sideform/browser-agent/agent/session";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { FRAME_SURFACE } from "./parts";
import { cn } from "@/lib/utils";
import { buildDomSrcdoc } from "./domSrcdoc";
import { readDomText } from "@/lib/trace/domText";

type Loaded = { src: string; text: string } | { src: string; error: string };

/**
 * The DOM snapshot of a step. `html` is shown in a fully sandboxed iframe (an EMPTY `sandbox` attribute: no scripts, no
 * same origin, no forms, no navigation); `ax` is shown as read-only text. There is no link to open it elsewhere: that
 * would run it without the sandbox.
 */
export function DomView({ dom, stepNumber, cloudTraceId }: { dom: BrowseTraceDom; stepNumber: number; cloudTraceId?: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Per DOM view (the iframe is keyed by the snapshot): off until the viewer asks.
  const [remote, setRemote] = useState<{ id: number; on: boolean }>({ id: dom.id, on: false });
  const remoteImages = remote.id === dom.id && remote.on;
  useEffect(() => {
    const controller = new AbortController();
    readDomText(dom, cloudTraceId, controller.signal).then(
      (text) => setLoaded({ src: dom.src, text }),
      (error: unknown) => {
        if (!controller.signal.aborted) setLoaded({ src: dom.src, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => controller.abort();
  }, [dom, cloudTraceId]);

  const current = loaded && loaded.src === dom.src ? loaded : null;
  // Page address and title are plain text, never a link.
  const where = [dom.title, dom.url].filter(Boolean).join(" · ");
  if (!current) {
    return (
      <p role="status" data-testid="dom-loading" className="text-sm text-text-muted">
        Loading the DOM snapshot…
      </p>
    );
  }
  if ("error" in current) {
    return <EmptyState size="panel" title="The DOM snapshot could not be loaded" description={current.error} />;
  }
  const caption = where ? (
    <p data-testid="dom-where" className="mb-1 truncate text-xs text-text-muted">
      {where}
    </p>
  ) : null;
  if (dom.kind === "ax") {
    const from = dom.sourceStepIndex;
    return (
      <div className="flex h-full w-full min-w-0 flex-col">
        {caption}
        {from !== undefined && from !== dom.stepIndex && (
          <p data-testid="dom-ax-source" className="mb-1 text-xs text-text-muted">
            Accessibility tree from step {from + 1} (no page change since)
          </p>
        )}
      <pre
        data-testid="dom-ax"
        tabIndex={0}
        aria-label={`Accessibility tree of step ${stepNumber}`}
        className={cn("min-h-0 w-full flex-1 overflow-auto rounded-lg p-3 text-left font-mono text-xs/relaxed whitespace-pre text-text-primary", FRAME_SURFACE)}
      >
        {current.text}
      </pre>
      </div>
    );
  }
  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      {caption}
      <label
        className="mb-1 flex w-fit items-center gap-1.5 text-xs text-text-muted"
        title="Off: the snapshot loads nothing from the network. On: its images load from the recorded site, which contacts that site."
      >
        <input type="checkbox" checked={remoteImages} onChange={(e) => setRemote({ id: dom.id, on: e.target.checked })} />
        Load remote images
      </label>
    <iframe
      key={dom.id}
      data-testid="dom-frame"
      title={`DOM snapshot of step ${stepNumber}`}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={buildDomSrcdoc(current.text, remoteImages)}
      className={cn("min-h-0 w-full flex-1 rounded-lg border-0 bg-white", FRAME_SURFACE)}
    />
    </div>
  );
}
