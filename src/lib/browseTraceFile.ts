import { apiFetch } from "@/lib/apiBase";
import { cloudDomPath } from "@/lib/trace/domText";
import { domTextToDataUrl, type BrowseTrace, type BrowseTraceDom } from "@sideform/browser-agent/agent/session";
import { validate, type TraceLoadResult } from "@/lib/browseTraceLoad";

// A trace as one portable .json file: frames inlined as data URLs, so the file opens anywhere.

const INLINE_MIME = /^image\/(jpeg|png|webp)$/;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The frame could not be read."));
    reader.readAsDataURL(blob);
  });
}

/** The frame's image as a data URL; null when it cannot be fetched or is not jpeg, png or webp. */
async function inlineFrame(src: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(src);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!INLINE_MIME.test(blob.type)) return null;
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

/** The DOM snapshot's text as a data URL; null when it cannot be fetched. Fetched as text, never navigated to. */
async function inlineDom(dom: BrowseTraceDom, cloudTraceId: string | undefined): Promise<string | null> {
  if (!cloudTraceId) return null;
  try {
    const response = await apiFetch(cloudDomPath(cloudTraceId, dom));
    return response.ok ? domTextToDataUrl(dom.kind, await response.text()) : null;
  } catch {
    return null;
  }
}

/**
 * The trace as a JSON file. DOM snapshots are read through the backend route of a cloud trace (`cloudTraceId`); elsewhere they stay as they are. A frame that cannot be inlined keeps its address (still valid when the file is opened);
 * `notInlined` counts those, so the file needs network access to show them.
 */
export async function exportBrowseTrace(trace: BrowseTrace, fetchImpl: typeof fetch = (...args) => fetch(...args), cloudTraceId?: string): Promise<{ blob: Blob; notInlined: number }> {
  let notInlined = 0;
  const frames = await Promise.all(
    trace.frames.map(async (frame) => {
      if (frame.src.startsWith("data:")) return frame;
      const src = await inlineFrame(frame.src, fetchImpl);
      if (!src) notInlined++;
      return src ? { ...frame, src } : frame;
    }),
  );
  const doms = trace.doms
    ? await Promise.all(
        trace.doms.map(async (dom) => {
          if (dom.src.startsWith("data:")) return dom;
          const src = await inlineDom(dom, cloudTraceId);
          if (!src) notInlined++;
          return src ? { ...dom, src } : dom;
        }),
      )
    : undefined;
  return { blob: new Blob([JSON.stringify({ ...trace, frames, ...(doms ? { doms } : {}) })], { type: "application/json" }), notInlined };
}

/** Parses a chosen file as a trace. Never rejects. */
export async function readBrowseTraceFile(file: Blob): Promise<TraceLoadResult> {
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    return { ok: false, reason: "invalid", message: "The file is not valid JSON." };
  }
  return validate(value);
}

export const traceFileName = (trace: BrowseTrace): string => `trace-${trace.id}.json`;
