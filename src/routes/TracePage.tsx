import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { EditorProviders } from "@/components/EditorProviders";
import { TraceFilePicker } from "@/components/trace/TraceFilePicker";
import { TraceFailure, TraceSkeleton } from "@/components/trace/TraceStates";
import { TraceSwitcher } from "@/components/trace/TraceSwitcher";
import { TraceViewer } from "@/components/trace/TraceViewer";
import { traceTitle } from "@/components/trace/traceModel";
import { useHtmlRouteClass } from "@/hooks/useHtmlRouteClass";
import type { TraceSource } from "@/lib/browseTraces";
import { canListLocalTraces } from "@/lib/browseTraceList";
import { loadBrowseTrace, traceSourceFromParam, type TraceLoadResult } from "@/lib/browseTraceLoad";

/**
 * "/trace/:id": the viewer of a recorded browse run (`?src=local|cloud`,
 * default cloud; `?step=N` opens on that step). "/trace": open a trace file.
 * Must not import App, Pixi or the chat.
 */
export default function TracePage() {
  useHtmlRouteClass("route-trace");
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const source = traceSourceFromParam(params.get("src"));
  // Keyed: another trace starts from its own ?step=, not the previous one's.
  return <EditorProviders>{id ? <RemoteTrace key={`${source}:${id}`} id={id} source={source} /> : <TraceFilePicker />}</EditorProviders>;
}

function RemoteTrace({ id, source }: { id: string; source: TraceSource }) {
  const [params] = useSearchParams();
  // Read once: the viewer then keeps the address in step with its selection itself.
  const [stepParam] = useState(() => params.get("step"));
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; result: TraceLoadResult } | null>(null);
  const key = `${source}:${id}:${attempt}`;
  const result = loaded?.key === key ? loaded.result : null;

  useEffect(() => {
    let cancelled = false;
    void loadBrowseTrace(id, source).then((next) => {
      if (!cancelled) setLoaded({ key, result: next });
    });
    return () => {
      cancelled = true;
    };
  }, [id, source, key]);

  const goal = result?.ok ? result.trace.goal : undefined;
  const notFound = result !== null && !result.ok && result.reason === "not-found";
  useEffect(() => {
    const previous = document.title;
    document.title = goal !== undefined ? traceTitle(goal) : notFound ? "Trace not found" : "Trace";
    return () => {
      document.title = previous;
    };
  }, [goal, notFound]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // Only where the shell can list traces; a bare element would draw an empty top bar on the web.
  const switcher = canListLocalTraces() ? <TraceSwitcher currentId={id} source={source} /> : undefined;

  return result === null ? (
    <TraceSkeleton />
  ) : result.ok ? (
    <TraceViewer key={result.trace.id} trace={result.trace} initialStep={stepParam} switcher={switcher} />
  ) : (
    <TraceFailure failure={result} onRetry={retry} switcher={switcher} />
  );
}
