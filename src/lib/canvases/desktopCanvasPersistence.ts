// Desktop shell only: persists the editor's canvas to disk through
// `window.penDesktop.canvases` (read/save), keyed by the `?canvas=<id>` of the tab URL.
// Load first, autosave after: an empty editor must never overwrite a stored canvas.
// On the web (no bridge), in `?view` mode and in the shared viewer this is a no-op.
//
// The load/save state lives at MODULE level (one `Session` per canvas id), not inside the
// effect: App can remount (router `navigate('/app')`, StrictMode) while the scene stores
// still hold the scene. A remount with the same id reuses the session (no second read, no
// re-apply over newer in-memory edits, same rev and last-saved hash). If the stores were
// replaced while App was unmounted (shared viewer and back), the remount forks to a NEW id.

import { toast } from "sonner";
import type { DesktopCanvasesApi, StoredCanvas } from "@/lib/desktopBridge";
import { deserializeDocument } from "@/utils/fileUtils";
import { applyOpenedDocument } from "@/utils/openDocumentIntoEditor";
import { getCanvasViewportMetrics } from "@/utils/canvasViewport";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSharedViewStore } from "@/store/sharedViewStore";
import { useSceneStore } from "@/store/sceneStore";
import { usePageStore } from "@/store/pageStore";
import type { PageData } from "@/store/pageStore";
import { useVariableStore } from "@/store/variableStore";
import { useTextStyleStore } from "@/store/textStyleStore";
import { useStyleStore } from "@/store/styleStore";
import { useThemeStore } from "@/store/themeStore";
import { useGuidesStore } from "@/store/guidesStore";
import { useMeasurementsStore } from "@/store/measurementsStore";
import { useCommentsStore } from "@/store/commentsStore";
import { useDocumentStore } from "@/store/documentStore";
import {
  assignNewCanvasId,
  deriveCanvasTitle,
  ensureCanvasIdInUrl,
  hasAnyNode,
  serializeLiveDocument,
} from "./canvasIdentity";

export const AUTOSAVE_DEBOUNCE_MS = 1000;
/** A save runs at most this long after the first unsaved change, however long changes keep coming. */
export const AUTOSAVE_MAX_WAIT_MS = 5000;
/** Delay before retrying a failed save. */
export const AUTOSAVE_RETRY_MS = 5000;
/** The canvas host waits at most this long for the initial load. */
export const READY_CAP_MS = 5000;
/** Longest wait for a frame after applying a stored canvas, before the baseline is taken anyway. */
const SETTLE_FRAME_CAP_MS = 100;
/** Consecutive save failures before the user is told. */
const SAVE_FAILURES_BEFORE_NOTICE = 2;

export const SAVE_FAILED_MESSAGE = "This canvas could not be saved. Export it to keep your work.";
export const OPEN_FAILED_MESSAGE = "Could not open the saved canvas.";

type Bridge = Required<Pick<DesktopCanvasesApi, "read" | "save">>;
type NoticeKind = "save" | "open";

interface Session {
  id: string;
  /** loading: read in progress. ready: autosave may run. disabled: read/apply failed, never save. */
  phase: "loading" | "ready" | "disabled";
  /** Resolves when `phase` leaves "loading". Never rejects. */
  ready: Promise<void>;
  rev: number;
  /** Something is on disk for this id (or we saved it). */
  stored: boolean;
  /** Cheap fingerprint of the last document written (or loaded); null = unknown. */
  lastSaved: string | null;
  failures: number;
  /** Store slice references after the last successful save/baseline; unchanged = nothing to serialize. */
  savedRefs: unknown[] | null;
  /** Store slice references seen at the last teardown; a difference on remount = foreign document. */
  observed: unknown[] | null;
}

let session: Session | null = null;
/** Instances of the effect currently mounted. */
let active = 0;
const noticed = new Set<NoticeKind>();

function getBridge(): Bridge | undefined {
  if (typeof window === "undefined") return undefined;
  const api = window.penDesktop?.canvases;
  return api && typeof api.read === "function" && typeof api.save === "function" ? (api as Bridge) : undefined;
}

function warn(what: string, detail?: unknown): void {
  console.warn(`desktopCanvasPersistence: ${what}`, detail ?? "");
}

/** One toast per failure kind; "save" re-arms after a successful save, "open" never does. */
function notifyOnce(kind: NoticeKind): void {
  if (noticed.has(kind)) return;
  noticed.add(kind);
  try {
    toast.error(kind === "save" ? SAVE_FAILED_MESSAGE : OPEN_FAILED_MESSAGE);
  } catch (e) {
    warn("notice failed", e);
  }
}

/** cyrb53 over the string plus its length: a cheap fingerprint, so no second copy of a big document is kept. */
function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length}:${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
}

function samePageContent(a: PageData, b: PageData): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.nodesById === b.nodesById &&
    a.childrenById === b.childrenById &&
    a.rootIds === b.rootIds &&
    a.pageBackground === b.pageBackground &&
    a.guides === b.guides &&
    a.slideOrder === b.slideOrder &&
    a.measurements === b.measurements &&
    a.comments === b.comments
  );
}

// Document-relevant slices only: selection-like and view state (expandedFrameIds, viewport,
// history stacks, selected measurement, draft anchors ...) never reach the file.
const docChanged = {
  scene: (s: ReturnType<typeof useSceneStore.getState>, p: typeof s) =>
    s.nodesById !== p.nodesById ||
    s.childrenById !== p.childrenById ||
    s.rootIds !== p.rootIds ||
    s.pageBackground !== p.pageBackground ||
    s.slideOrder !== p.slideOrder,
  pages: (s: ReturnType<typeof usePageStore.getState>, p: typeof s) => {
    if (s.activePageId !== p.activePageId) return true;
    if (s.pages === p.pages) return false;
    return s.pages.length !== p.pages.length || s.pages.some((page, i) => !samePageContent(page, p.pages[i]));
  },
};

/** References of every store slice that feeds the file; equal arrays = no document change. */
function sliceRefs(): unknown[] {
  const sc = useSceneStore.getState();
  const pg = usePageStore.getState();
  return [
    sc.nodesById,
    sc.childrenById,
    sc.rootIds,
    sc.pageBackground,
    sc.slideOrder,
    pg.pages,
    pg.activePageId,
    useVariableStore.getState().variables,
    useTextStyleStore.getState().textStyles,
    useStyleStore.getState().fillStyles,
    useStyleStore.getState().effectStyles,
    useThemeStore.getState().activeTheme,
    useGuidesStore.getState().guides,
    useMeasurementsStore.getState().measurements,
    useCommentsStore.getState().threads,
    useDocumentStore.getState().fileName,
  ];
}

function sameRefs(a: unknown[] | null, b: unknown[] | null): boolean {
  return a !== null && b !== null && a.length === b.length && a.every((x, i) => x === b[i]);
}

function newSession(id: string): Session {
  return {
    id,
    phase: "loading",
    ready: Promise.resolve(),
    rev: 0,
    stored: false,
    lastSaved: null,
    failures: 0,
    savedRefs: null,
    observed: null,
  };
}

/** A fresh, ready, unsaved session under a NEW id for the document currently in the stores. */
function forkSession(): Session {
  const s = newSession(assignNewCanvasId());
  s.phase = "ready";
  return s;
}

/**
 * Starts persistence for this tab. Returns the teardown (idempotent), or undefined when
 * the feature is not active here (no bridge, not in edit mode, shared viewer).
 */
export function startDesktopCanvasPersistence(): (() => void) | undefined {
  const found = getBridge();
  if (!found) return undefined;
  const bridge: Bridge = found;
  if (useEditorModeStore.getState().mode !== "edit") return undefined;
  if (useSharedViewStore.getState().isSharedView) return undefined;

  const id = ensureCanvasIdInUrl();
  if (!session || session.id !== id) {
    session = beginSession(id, bridge);
  } else if (session.observed !== null && !sameRefs(session.observed, sliceRefs())) {
    // The stores were replaced while App was unmounted (shared viewer -> "Open editor"): what is
    // in them is not this canvas. Never autosave it under the old id.
    warn("the document changed while the editor was unmounted; forking to a new canvas id");
    session = forkSession();
  }
  const s = session;
  active += 1;

  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let dirty = false;
  let retryAfterFailure = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstChangeAt: number | undefined;
  let unsubscribes: Array<() => void> = [];

  function clearTimer(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    firstChangeAt = undefined;
  }

  /** Debounced, but never later than AUTOSAVE_MAX_WAIT_MS after the first unsaved change. */
  function schedule(delay = AUTOSAVE_DEBOUNCE_MS): void {
    if (stopped) return;
    const now = Date.now();
    firstChangeAt ??= now;
    if (timer !== undefined) clearTimeout(timer);
    const wait = Math.max(0, Math.min(delay, firstChangeAt + AUTOSAVE_MAX_WAIT_MS - now));
    timer = setTimeout(() => {
      timer = undefined;
      firstChangeAt = undefined;
      void save();
    }, wait);
  }

  function failed(): void {
    s.failures += 1;
    if (s.failures >= SAVE_FAILURES_BEFORE_NOTICE) notifyOnce("save");
    retryAfterFailure = true;
  }

  /** `force`: pagehide / flush / teardown, sends even while another save is in flight (the higher rev wins on disk). */
  function save(force = false): Promise<void> {
    if (s.phase !== "ready") return Promise.resolve();
    if (inFlight && !force) {
      dirty = true;
      return Promise.resolve();
    }
    // Transient during initFromDocument / import: never write a zero-page document.
    if (usePageStore.getState().pages.length === 0) return Promise.resolve();
    if (!s.stored && !hasAnyNode()) return Promise.resolve();
    const refs = sliceRefs();
    if (sameRefs(refs, s.savedRefs)) return Promise.resolve();
    let document: string;
    try {
      document = serializeLiveDocument();
    } catch (e) {
      warn("serialize failed", e);
      failed();
      if (retryAfterFailure) schedule(AUTOSAVE_RETRY_MS);
      return Promise.resolve();
    }
    const key = fingerprint(document);
    if (key === s.lastSaved) {
      s.savedRefs = refs;
      return Promise.resolve();
    }

    s.rev += 1;
    const sentRev = s.rev;
    const rollBack = (): void => {
      // Only undo our own increment: an overlapping forced save may have bumped it since.
      if (s.rev === sentRev) s.rev -= 1;
    };
    const payload: StoredCanvas = { id: s.id, title: deriveCanvasTitle(), updatedAt: Date.now(), rev: sentRev, document };
    dirty = false;
    retryAfterFailure = false;
    const p: Promise<void> = bridge
      .save(payload)
      .then(
        (res) => {
          if (res && "error" in res) {
            warn("save failed", res.error);
            rollBack();
            failed();
            return;
          }
          if (res && "stale" in res) {
            warn("save was stale; adopting disk rev", res.rev);
            s.rev = Math.max(s.rev, res.rev);
            dirty = true;
            return;
          }
          s.stored = true;
          s.lastSaved = key;
          s.savedRefs = refs;
          s.failures = 0;
          noticed.delete("save");
          if (res && typeof res.rev === "number") s.rev = Math.max(s.rev, res.rev);
        },
        (e: unknown) => {
          warn("save rejected", e);
          rollBack();
          failed();
        },
      )
      .finally(() => {
        if (inFlight === p) inFlight = null;
        if (retryAfterFailure) schedule(AUTOSAVE_RETRY_MS);
        else if (dirty) schedule();
      });
    inFlight = p;
    return p;
  }

  function onPageHide(): void {
    clearTimer();
    void save(true);
  }

  /**
   * `window.penCanvasFlush`: saves whatever is unsaved and resolves after that save's reply
   * (at once when nothing is pending; an in-flight save is awaited too). Never rejects.
   */
  async function flush(): Promise<void> {
    try {
      await whenCanvasLoadReady();
      if (s.phase !== "ready") return;
      if (inFlight) await inFlight.catch(() => {});
      if (dirty || timer !== undefined) {
        clearTimer();
        await save(true);
      }
    } catch (e) {
      warn("flush failed", e);
    }
  }

  function startAutosave(): void {
    if (stopped) return;
    const onChange = () => schedule();
    unsubscribes = [
      useSceneStore.subscribe((st, prev) => docChanged.scene(st, prev) && onChange()),
      usePageStore.subscribe((st, prev) => docChanged.pages(st, prev) && onChange()),
      useVariableStore.subscribe((st, prev) => st.variables !== prev.variables && onChange()),
      useTextStyleStore.subscribe((st, prev) => st.textStyles !== prev.textStyles && onChange()),
      useStyleStore.subscribe(
        (st, prev) => (st.fillStyles !== prev.fillStyles || st.effectStyles !== prev.effectStyles) && onChange(),
      ),
      useThemeStore.subscribe((st, prev) => st.activeTheme !== prev.activeTheme && onChange()),
      useGuidesStore.subscribe((st, prev) => st.guides !== prev.guides && onChange()),
      useMeasurementsStore.subscribe((st, prev) => st.measurements !== prev.measurements && onChange()),
      useCommentsStore.subscribe((st, prev) => st.threads !== prev.threads && onChange()),
      // The file name feeds the stored title.
      useDocumentStore.subscribe((st, prev) => st.fileName !== prev.fileName && onChange()),
    ];
    window.addEventListener("pagehide", onPageHide);
    // Content that arrived while the read was in flight, or that the read could not replace.
    if (s.lastSaved === null && hasAnyNode()) schedule();
  }

  window.penCanvasFlush = flush;
  void s.ready.then(() => {
    if (!stopped && s.phase === "ready") startAutosave();
  });

  return () => {
    if (stopped) return;
    stopped = true;
    active -= 1;
    // A change made in the last debounce window, or during an in-flight save, must not be lost with the effect.
    const unsaved = timer !== undefined || dirty;
    clearTimer();
    for (const off of unsubscribes) off();
    unsubscribes = [];
    window.removeEventListener("pagehide", onPageHide);
    if (window.penCanvasFlush === flush) delete window.penCanvasFlush;
    s.observed = sliceRefs();
    if (unsaved && s.phase === "ready") void save(true);
  };
}

/** Waits one macrotask and one frame (bounded: a hidden tab never fires rAF). */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        resolve();
      };
      setTimeout(finish, SETTLE_FRAME_CAP_MS);
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(finish);
    }, 0);
  });
}

function beginSession(id: string, bridge: Bridge): Session {
  const s = newSession(id);
  const disable = (what: string, detail?: unknown): void => {
    warn(`${what}; autosave disabled for this canvas`, detail);
    s.phase = "disabled";
    notifyOnce("open");
  };
  s.ready = (async () => {
    let result: Awaited<ReturnType<Bridge["read"]>>;
    try {
      result = await bridge.read(id);
    } catch (e) {
      if (session !== s) return;
      if (active > 0) disable("read rejected", e);
      else session = null;
      return;
    }
    // Superseded (forked on a foreign-document remount): nothing here may touch the stores.
    if (session !== s) return;
    if (active === 0) {
      // Every instance went away while reading and none came back: nothing is on screen to fill.
      session = null;
      return;
    }
    if (!result || "error" in result) {
      disable("read failed", result && "error" in result ? result.error : result);
      return;
    }
    const canvas = result.canvas;
    if (canvas) {
      if (hasAnyNode()) {
        // The user, the agent or a paste already put something in the scene while the read was in
        // flight. Neither side may overwrite the other: the stored canvas stays intact under its
        // id, and this tab continues as a NEW unsaved canvas holding the live scene.
        warn("scene changed during the initial read; forking the live scene to a new canvas id");
        s.id = assignNewCanvasId();
        s.rev = 0;
        s.stored = false;
        s.phase = "ready";
        return;
      }
      s.rev = canvas.rev;
      s.stored = true;
      try {
        const data = deserializeDocument(canvas.document);
        const { width, height } = getCanvasViewportMetrics();
        // A silent restore: it must not flip the editor chrome (UI) theme of this window.
        applyOpenedDocument(data, { viewportWidth: width, viewportHeight: height, syncUITheme: false });
      } catch (e) {
        disable("stored canvas could not be applied", e);
        return;
      }
      // Layout / migration passes run after the apply: take the baseline once they settled, so
      // they do not look like edits (and rewrite an untouched file, bumping it in Recent).
      await settle();
      if (session !== s) return;
      try {
        s.lastSaved = fingerprint(serializeLiveDocument());
        s.savedRefs = sliceRefs();
      } catch {
        s.lastSaved = null;
      }
    }
    s.phase = "ready";
  })();
  return s;
}

/** true while the initial read of this tab's canvas has not finished. */
export function isCanvasLoadPending(): boolean {
  return session?.phase === "loading";
}

/**
 * Resolves once the initial load is over (immediately when persistence is inactive, as on
 * the web or in view mode), at the latest after `READY_CAP_MS` so a stuck read never hangs
 * the caller.
 */
export function whenCanvasLoadReady(capMs = READY_CAP_MS): Promise<void> {
  const s = session;
  if (!s || s.phase !== "loading") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, capMs);
    void s.ready.then(() => {
      clearTimeout(t);
      resolve();
    });
  });
}

/** Test seam: forget the module-level session and notices. */
export function resetDesktopCanvasPersistenceForTests(): void {
  session = null;
  active = 0;
  noticed.clear();
}
