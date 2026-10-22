import { parseBrowseTrace, type BrowseTraceFrame } from "@sideform/browser-agent/agent/session";
import { getAgentPanelTraceTabsBridge } from "../agentPanel";

type TraceFramesRead = { frames: boolean; frameIds?: number[] };

async function readParsedTrace(traceId: string, opts: TraceFramesRead) {
  const bridge = getAgentPanelTraceTabsBridge();
  if (!bridge) throw new Error("Trace tabs are not available here (desktop app only).");
  const result: unknown = await bridge.read(traceId, opts);
  if (!result || typeof result !== "object") throw new Error("The desktop app returned an unexpected answer.");
  if ("error" in result) throw new Error(String((result as { error: unknown }).error));
  const parsed = parseBrowseTrace((result as { trace?: unknown }).trace);
  if ("error" in parsed) throw new Error(`The trace is not valid: ${parsed.error}`);
  const frames = parsed.trace.frames ?? [];
  if (frames.length === 0) throw new Error(`The trace "${traceId}" has no screenshots.`);
  return frames;
}

/**
 * One frame of an open trace tab, with its image `src` (a data: image URL or an http(s) URL). The shell inlines only
 * the asked frame (`frameIds`; an older shell ignores the option and inlines every frame, 10-25 MB of base64, which is
 * still correct). `frameId` undefined = the last screenshot (a "final" frame is preferred): a frames-free read finds
 * its id first. Throws an Error with an actionable message.
 */
export async function readTraceFrame(traceId: string, frameId: number | undefined): Promise<BrowseTraceFrame> {
  let wanted = frameId;
  if (wanted === undefined) {
    const listed = await readParsedTrace(traceId, { frames: false });
    wanted = [...listed].sort((a, b) => (a.kind === "final" ? 1 : 0) - (b.kind === "final" ? 1 : 0) || a.at - b.at || a.id - b.id).at(-1)?.id;
  }
  const frames = await readParsedTrace(traceId, wanted === undefined ? { frames: true } : { frames: true, frameIds: [wanted] });
  let frame;
  if (frameId === undefined) {
    frame = frames.find((f) => f.id === wanted);
  } else {
    frame = frames.find((f) => f.id === frameId);
    if (!frame) {
      const ids = frames.slice(-10).map((f) => f.id).join(", ");
      throw new Error(`Unknown frameId ${frameId} in trace "${traceId}". Latest frameIds: ${frames.length > 10 ? "..., " : ""}${ids}. Call trace_read to see the frames (frames.shown[].frameId).`);
    }
  }
  const src = frame?.src;
  if (!frame || typeof src !== "string" || !(/^data:image\//i.test(src) || /^https?:\/\//i.test(src))) {
    throw new Error("The frame image could not be loaded (the trace holds no image data for it).");
  }
  return frame;
}
