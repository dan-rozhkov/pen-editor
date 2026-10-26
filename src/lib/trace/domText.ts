import type { BrowseTraceDom } from "@sideform/browser-agent/agent/session";
import { apiFetch } from "@/lib/apiBase";

/** Longest DOM text the viewer reads; the recorder caps a snapshot far below this, so more is not ours. */
const MAX_DOM_CHARS = 8_000_000;

export const DOM_UNAVAILABLE = "DOM snapshot is not available for this trace.";

/** The text of a `data:text/...;base64,` URL (UTF-8). Throws on anything else. */
export function decodeTextDataUrl(src: string): string {
  const match = /^data:text\/(?:html|plain)(?:;[^,]*)?;base64,(.*)$/is.exec(src);
  if (!match) throw new Error("The DOM snapshot has an unknown format.");
  const binary = atob(match[1]!);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** The backend route that serves one DOM snapshot as text with the app's CORS (the public bucket sends none). */
export const cloudDomPath = (traceId: string, dom: Pick<BrowseTraceDom, "id" | "kind">): string =>
  `/api/browse/traces/${encodeURIComponent(traceId)}/dom/${dom.id}.${dom.kind === "html" ? "html" : "txt"}`;

/**
 * The snapshot text. A data URL (desktop and file traces) is decoded locally. A cloud trace (`cloudTraceId`) is FETCHED
 * as text through the backend route, never from the bucket address and never navigated to. Anything else is
 * unavailable.
 */
export async function readDomText(dom: BrowseTraceDom, cloudTraceId: string | undefined, signal: AbortSignal): Promise<string> {
  if (dom.src.startsWith("data:")) return decodeTextDataUrl(dom.src);
  if (!cloudTraceId) throw new Error(DOM_UNAVAILABLE);
  const response = await apiFetch(cloudDomPath(cloudTraceId, dom), { signal });
  if (!response.ok) throw new Error(`The server answered ${response.status}.`);
  const text = await response.text();
  if (text.length > MAX_DOM_CHARS) throw new Error("The DOM snapshot is too large to show.");
  return text;
}
