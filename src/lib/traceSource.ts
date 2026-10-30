import type { TraceSource } from "@/lib/browseTraces";

/** `?src=` -> a source. Anything but "local" is the cloud. Kept apart from the trace loader so /doc does not load it. */
export function traceSourceFromParam(value: string | null): TraceSource {
  return value === "local" ? "local" : "cloud";
}
