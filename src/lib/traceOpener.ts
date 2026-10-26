import type { SavedTrace } from "@/lib/browseTraces";

/**
 * How a trace opens. A local trace needs the desktop panel (it opens a trace tab); a cloud trace opens the viewer
 * route in a new browser tab, also from the panel. A local trace without the panel bridge has no viewer.
 */
export function traceOpener(trace: SavedTrace): (() => void) | undefined {
  if (trace.source === "cloud") {
    return () => void window.open(`${import.meta.env.BASE_URL}trace/${encodeURIComponent(trace.id)}?src=cloud`, "_blank", "noopener");
  }
  const open = window.penAgentPanel?.traces?.open;
  return open ? () => void open.call(window.penAgentPanel?.traces, trace.id).catch(() => undefined) : undefined;
}
