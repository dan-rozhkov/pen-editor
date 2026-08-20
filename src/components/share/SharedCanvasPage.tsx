import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { fetchSharedCanvas, saveShareCredentials, type SharedCanvasPayload } from "@/lib/shareCanvas";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { getCanvasElement, getCanvasViewportMetrics } from "@/utils/canvasViewport";
import { useDocumentStore } from "@/store/documentStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSharedViewStore } from "@/store/sharedViewStore";
import { useViewportStore } from "@/store/viewportStore";
import { track } from "@/lib/analytics";
import { SharedCanvasBar } from "@/components/share/SharedCanvasBar";

// Same reasoning as AppRouter's `EditorApp`: the editor drags in PixiJS and
// the whole canvas/tool stack, which must never load on "/" (the showcase).
// The viewer route lives behind `/c/:shareId`, its own lazy chunk, for the
// same reason.
const EditorApp = lazy(() => import("@/App"));

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string; notFound: boolean }
  | { status: "ready"; canvas: SharedCanvasPayload };

// No shareId means the route matched with an empty/absent :shareId segment —
// shouldn't happen given how the route is declared, but useParams()'s type
// allows it. Computed once as the initial state (rather than via a
// synchronous setState() at the top of the fetch effect below, which the
// react-hooks/set-state-in-effect rule flags) since it never changes for a
// given mount.
function initialState(shareId: string | undefined): LoadState {
  return shareId
    ? { status: "loading" }
    : { status: "error", error: "This canvas link doesn't exist or was removed.", notFound: true };
}

export default function SharedCanvasPage() {
  const { shareId } = useParams<{ shareId: string }>();
  const [state, setState] = useState<LoadState>(() => initialState(shareId));
  // Guards against React StrictMode's dev double-effect (and a shareId
  // change) applying the fetched document into the live stores twice.
  const appliedForRef = useRef<string | null>(null);

  useEffect(() => {
    useSharedViewStore.getState().setSharedView(true);
    return () => {
      useSharedViewStore.getState().setSharedView(false);
      // Read-only view mode is only ever entered by this page (or the
      // `?view` URL param, which is equally non-editable) — leaving the
      // viewer without exiting it back to "edit" would drop the visitor
      // into /app fully read-only with no draw tools, no rulers, no command
      // palette, and no in-app way back (see editorModeStore.ts: view mode
      // is enterable only from here, never exitable through the UI).
      useEditorModeStore.getState().exitToEdit();
    };
  }, []);

  useEffect(() => {
    if (!shareId) return;

    let cancelled = false;

    void fetchSharedCanvas(shareId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState({
          status: "error",
          error: result.error,
          notFound: /doesn't exist|removed/i.test(result.error),
        });
        return;
      }
      if (appliedForRef.current !== shareId) {
        appliedForRef.current = shareId;
        // This visitor's OWN share credentials (if any) are still sitting in
        // localStorage from whatever document they had open before landing
        // on this link. `applyOpenedDocument` below is about to load
        // SOMEONE ELSE's document into the same live stores this tab's
        // editor uses — without this, clicking "Open editor" and then
        // File -> Share… -> "Update" would POST the shared document back
        // under the visitor's own shareId+editToken, silently replacing
        // their published canvas with the one they were just viewing. See
        // shareCanvas.ts's `subscribeToShareCredentials` doc for how this
        // propagates to shareStore automatically.
        saveShareCredentials(null);
        const { width, height } = getCanvasViewportMetrics();
        applyOpenedDocument(result.canvas.data, { viewportWidth: width, viewportHeight: height });
        useDocumentStore.getState().setFileName(result.canvas.title);
        useEditorModeStore.getState().enterView();
      }
      track("shared_canvas_viewed", { share_id: shareId });
      setState({ status: "ready", canvas: result.canvas });
    });

    return () => {
      cancelled = true;
    };
  }, [shareId]);

  // `applyOpenedDocument` above runs from the fetch callback, before
  // <EditorApp/> (and therefore PixiCanvas's `[data-canvas]` element) has
  // ever rendered — so `getCanvasViewportMetrics()` falls back to the full
  // window there. On desktop the real canvas is 350-500px narrower once the
  // rail/sidebar/right panel mount, so that initial fit is measurably
  // off-center. Re-fit once the canvas element actually exists, without
  // touching the initial (unfitted) render so nothing flashes unfitted
  // longer than it already does.
  const readyCanvas = state.status === "ready" ? state.canvas : null;
  useEffect(() => {
    if (!readyCanvas) return;
    let cancelled = false;
    let rafId = 0;
    const tryFit = () => {
      if (cancelled) return;
      const canvasEl = getCanvasElement();
      if (!canvasEl) {
        rafId = requestAnimationFrame(tryFit);
        return;
      }
      const { width, height } = getCanvasViewportMetrics();
      const nodes = readyCanvas.data.pages[0]?.nodes ?? [];
      useViewportStore.getState().fitToContent(nodes, width, height);
    };
    rafId = requestAnimationFrame(tryFit);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [readyCanvas]);

  if (state.status === "loading") {
    return (
      <div className="flex h-dvh w-dvw items-center justify-center bg-background text-text-muted text-sm">
        Loading canvas…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-dvh w-dvw items-center justify-center bg-background px-4">
        <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-border-default bg-surface-panel px-6 py-8 text-center">
          <p className="text-sm text-text-default">
            {state.notFound
              ? "This canvas link doesn't exist or was removed."
              : state.error}
          </p>
          <Link to="/" className="text-xs text-accent-primary hover:underline">
            Go back home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={null}>
      <EditorApp />
      <SharedCanvasBar title={state.canvas.title} shareId={state.canvas.id} />
    </Suspense>
  );
}
