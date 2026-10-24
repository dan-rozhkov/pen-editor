// Pure helpers for desktop canvas persistence: the canvas id in the tab URL, the
// stored title, and a side-effect-free build of the live document.

import { usePageStore } from "@/store/pageStore";
import { useSceneStore } from "@/store/sceneStore";
import { useDocumentStore } from "@/store/documentStore";
import { serializeDocument } from "@/utils/fileUtils";
import { buildLiveDocumentData } from "@/lib/commands/fileCommands";

export const CANVAS_PARAM = "canvas";
export const UNTITLED_CANVAS = "Untitled canvas";
const MAX_TITLE = 200;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** `cv_` + 16 random lowercase alphanumerics. */
export function generateCanvasId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "cv_";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function isValidCanvasId(id: string | null | undefined): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

const SESSION_KEY = "pen.canvasId";

function readSessionId(): string | null {
  try {
    const v = window.sessionStorage.getItem(SESSION_KEY);
    return isValidCanvasId(v) ? v : null;
  } catch {
    return null;
  }
}

function writeSessionId(id: string): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    /* storage blocked: the URL param alone then carries the id */
  }
}

/**
 * The canvas id of this tab: `?canvas=` first, else the id kept in `sessionStorage` (per
 * tab / webContents; survives a router `navigate('/app')` that drops the query, e.g. a
 * sign-in or account round-trip), else a new one. The result is written to both places;
 * the URL gets it via `history.replaceState`, keeping every other param, the hash and the
 * router's `history.state` (react-router keeps its location key there; same approach as
 * SignInPage). The router is not told, which is fine: nothing on /app reads `canvas`.
 */
export function ensureCanvasIdInUrl(): string {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get(CANVAS_PARAM);
  if (isValidCanvasId(fromUrl)) {
    writeSessionId(fromUrl);
    return fromUrl;
  }
  const id = readSessionId() ?? generateCanvasId();
  writeSessionId(id);
  writeIdToUrl(url, id);
  return id;
}

function writeIdToUrl(url: URL, id: string): void {
  url.searchParams.set(CANVAS_PARAM, id);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

/** Gives this tab a NEW canvas id (URL param + sessionStorage), e.g. to fork away from a stored canvas. */
export function assignNewCanvasId(): string {
  const id = generateCanvasId();
  writeSessionId(id);
  writeIdToUrl(new URL(window.location.href), id);
  return id;
}

function clean(title: string): string {
  return title.trim().slice(0, MAX_TITLE).trim();
}

/** File name without extension, else the first top-level frame of the first page, else "Untitled canvas". */
export function deriveCanvasTitle(): string {
  const fileName = useDocumentStore.getState().fileName?.replace(/\.[^.]+$/, "");
  const fromFile = fileName ? clean(fileName) : "";
  if (fromFile) return fromFile;

  const { pages, activePageId } = usePageStore.getState();
  const first = pages[0];
  if (first) {
    // The active page's data lives in sceneStore until the page is switched away from.
    const live = first.id === activePageId ? useSceneStore.getState() : first;
    for (const id of live.rootIds) {
      const node = live.nodesById[id];
      if (node?.type === "frame") {
        const name = clean(node.name ?? "");
        if (name) return name;
      }
    }
  }
  return UNTITLED_CANVAS;
}

/** Whether any page holds a node (the active page is read live from sceneStore). */
export function hasAnyNode(): boolean {
  const { pages, activePageId } = usePageStore.getState();
  if (pages.length === 0) return useSceneStore.getState().rootIds.length > 0;
  return pages.some((p) =>
    p.id === activePageId ? useSceneStore.getState().rootIds.length > 0 : p.rootIds.length > 0,
  );
}

/**
 * The compact `.pen` JSON of the live document, built by the shared non-mutating
 * `buildLiveDocumentData()` (it does NOT call `saveCurrentPageState()`: that writes `pages`
 * into pageStore, which would re-trigger this very autosave and copy history stacks).
 */
export function serializeLiveDocument(): string {
  const d = buildLiveDocumentData();
  return serializeDocument(d.pages, d.variables, d.activeTheme, d.textStyles, d.fillStyles, d.effectStyles, false);
}
