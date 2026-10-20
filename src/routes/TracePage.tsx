import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { EditorProviders } from "@/components/EditorProviders";
import { TraceFailure, TraceSkeleton } from "@/components/trace/TraceStates";
import { TraceViewer } from "@/components/trace/TraceViewer";
import { traceTitle } from "@/components/trace/traceModel";
import { useHtmlRouteClass } from "@/hooks/useHtmlRouteClass";
import { loadBrowseTrace, traceSourceFromParam, type TraceLoadResult } from "@/lib/browseTraceLoad";

/**
 * "/trace/:id": the viewer of a recorded browse run (`?src=local|cloud`,
 * default cloud). Must not import App, Pixi or the chat.
 */
export default function TracePage() {
  useHtmlRouteClass("route-trace");
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const source = traceSourceFromParam(params.get("src"));
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

  return (
    <EditorProviders>
      {result === null ? <TraceSkeleton /> : result.ok ? <TraceViewer key={result.trace.id} trace={result.trace} /> : <TraceFailure failure={result} onRetry={retry} />}
    </EditorProviders>
  );
}
