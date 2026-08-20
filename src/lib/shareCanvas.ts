// API client for "share your canvas by public link". Mirrors the
// never-throws contract of src/lib/showcasePublish.ts: every function here
// resolves to a discriminated result instead of throwing, so a caller can
// always render a friendly message instead of an uncaught rejection. This
// module owns no user-facing messaging beyond the string it returns — the UI
// layer (shareStore.ts and its consumers) decides how/when to show it (same
// split as showcasePublish's callers owning their own toasts).
import { collectDocumentData } from "@/lib/commands/fileCommands";
import { deserializeDocument, serializeDocument } from "@/utils/fileUtils";
import type { DocumentData } from "@/utils/fileUtils";
import { resolveApiUrl, isOffline } from "@/lib/apiBase";
import { getUserId } from "@/lib/userId";
import { useDocumentStore } from "@/store/documentStore";
import { useEditorModeStore } from "@/store/editorModeStore";

const SHARE_CREDENTIALS_KEY = "pen.share.current.v1";
const SHARE_TIMEOUT_MS = 60_000;
// Mirrors the backend's request-body limit for /api/canvas/share. Kept as a
// human-readable constant so the 413/400-too-large error message and the
// actual server limit can't silently drift apart without someone noticing
// this comment.
const SHARE_SIZE_LIMIT_LABEL = "~8 MB";

export interface ShareCredentials {
  id: string;
  editToken: string;
}

export type ShareResult =
  | { ok: true; id: string; editToken: string; url: string }
  | { ok: false; error: string };

export interface SharedCanvasPayload {
  id: string;
  title: string;
  data: DocumentData;
  updatedAt: string;
}

/**
 * Public URL for a shared canvas. `import.meta.env.BASE_URL` always ends in
 * a trailing slash (Vite's contract), so this never doubles or drops one.
 */
export function buildShareUrl(id: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}c/${id}`;
}

// Credentials are keyed "the share for whatever document is open right now"
// rather than by document id, because the editor has no document id of its
// own (see documentStore.ts — it tracks only a fileName). Re-sharing the same
// open document therefore updates the same link instead of minting a new
// one; opening a different document or starting a new one must call
// `saveShareCredentials(null)` to stop that update from landing on the wrong
// document (done in fileCommands.ts's open path and openDocument.ts's "new"
// branch).
export function loadShareCredentials(): ShareCredentials | null {
  try {
    const raw = localStorage.getItem(SHARE_CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ShareCredentials> | null;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.editToken !== "string") {
      return null;
    }
    return { id: parsed.id, editToken: parsed.editToken };
  } catch {
    return null;
  }
}

// Notification point for "the stored share credentials changed" — the
// single root fix for a family of staleness bugs where some consumer held
// onto credentials that no longer matched the open document: opening a
// `/c/:shareId` viewer, opening a different local document, starting a new
// one, or dropping a document onto the canvas all call
// `saveShareCredentials(null)` (or, in shareCurrentCanvas's success path,
// with fresh credentials), and every listener registered here is notified
// synchronously so nothing can miss the change or reset only part of its
// own state. `shareStore.ts` subscribes exactly once, at store creation,
// and derives its status/shareId/shareUrl entirely from whatever it's
// handed — so no call site needs to remember to reset the store too.
//
// Deliberately NOT importing shareStore here: shareCanvas.ts is already
// imported by fileCommands.ts (for `collectDocumentData`), which
// shareCanvas.ts imports back — a shareStore import here would close a real
// cycle (shareStore -> shareCanvas -> fileCommands -> shareCanvas).
const credentialListeners = new Set<(c: ShareCredentials | null) => void>();

/** Subscribe to every `saveShareCredentials` call. Returns an unsubscribe fn. */
export function subscribeToShareCredentials(
  fn: (c: ShareCredentials | null) => void,
): () => void {
  credentialListeners.add(fn);
  return () => credentialListeners.delete(fn);
}

export function saveShareCredentials(c: ShareCredentials | null): void {
  try {
    if (c === null) {
      localStorage.removeItem(SHARE_CREDENTIALS_KEY);
    } else {
      localStorage.setItem(SHARE_CREDENTIALS_KEY, JSON.stringify(c));
    }
  } catch {
    // localStorage unavailable (private mode / locked-down embed) — sharing
    // still works for this call, it just won't remember the link next time.
  }
  for (const fn of credentialListeners) fn(c);
}

function titleFromFileName(): string {
  const fileName = useDocumentStore.getState().fileName;
  const stripped = fileName?.replace(/\.[^.]+$/, "").trim();
  return stripped || "Untitled";
}

interface ShareApiSuccess {
  id: string;
  editToken: string;
  createdAt?: string;
  updatedAt?: string;
}

async function postShare(
  document: string,
  title: string,
  credentials: ShareCredentials | null,
): Promise<{ ok: true; data: ShareApiSuccess } | { ok: false; status: number; error?: string }> {
  const body = {
    userId: getUserId(),
    title,
    document,
    ...(credentials ? { shareId: credentials.id, editToken: credentials.editToken } : {}),
  };

  let res: Response;
  try {
    res = await fetch(resolveApiUrl("/api/canvas/share"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SHARE_TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network error" };
  }

  if (!res.ok) {
    let serverError: string | undefined;
    try {
      const data = (await res.json()) as { error?: string };
      serverError = data.error;
    } catch {
      // non-JSON error body — fall through to status-only handling
    }
    return { ok: false, status: res.status, error: serverError };
  }

  try {
    const parsed = (await res.json()) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { id?: unknown }).id !== "string" ||
      typeof (parsed as { editToken?: unknown }).editToken !== "string"
    ) {
      return { ok: false, status: res.status, error: "unexpected response shape" };
    }
    return { ok: true, data: parsed as ShareApiSuccess };
  } catch (e) {
    return { ok: false, status: res.status, error: e instanceof Error ? e.message : "invalid response" };
  }
}

function mapShareError(status: number, error: string | undefined): string {
  if (status === 503) {
    return "Canvas sharing isn't available on this server yet.";
  }
  if (status === 413 || (status === 400 && /large|size|too big/i.test(error ?? ""))) {
    return `This canvas is too large to share (limit is ${SHARE_SIZE_LIMIT_LABEL}). Large embedded images are the usual cause.`;
  }
  // The server now sends explicit, human-readable 400 messages (oversize
  // doc, per-owner share cap, shareId/editToken sent without the other) —
  // its own wording is the better message here, so surface it as-is
  // instead of burying it behind the generic "Sharing failed (400): …"
  // wrapper below (which is still the right shape for statuses that don't
  // carry a message worth showing verbatim).
  if (status === 400 && error) {
    return error;
  }
  if (status === 0) {
    return `Couldn't reach the server to share this canvas${error ? `: ${error}` : ""}.`;
  }
  return error ? `Sharing failed (${status}): ${error}` : `Sharing failed (${status}).`;
}

/**
 * Shares (or re-shares) the currently open document. Never throws — every
 * failure path resolves to `{ ok: false, error }`.
 */
export async function shareCurrentCanvas(): Promise<ShareResult> {
  if (isOffline()) {
    return { ok: false, error: "You're offline — sharing needs a network connection." };
  }

  const title = titleFromFileName();
  const doc = collectDocumentData();
  const serialized = serializeDocument(
    doc.pages,
    doc.variables,
    doc.activeTheme,
    doc.componentArtifacts,
    doc.textStyles,
    doc.fillStyles,
    doc.effectStyles,
  );

  const existing = loadShareCredentials();
  const first = await postShare(serialized, title, existing);

  if (first.ok) {
    const credentials: ShareCredentials = { id: first.data.id, editToken: first.data.editToken };
    saveShareCredentials(credentials);
    return { ok: true, id: credentials.id, editToken: credentials.editToken, url: buildShareUrl(credentials.id) };
  }

  // A 404 with stored credentials means the link is stale (deleted server
  // side, or from a different environment/database) — clear it and retry
  // once as a fresh create rather than surfacing a dead-end error for
  // something the user can recover from transparently.
  if (first.status === 404 && existing) {
    saveShareCredentials(null);
    const retry = await postShare(serialized, title, null);
    if (retry.ok) {
      const credentials: ShareCredentials = { id: retry.data.id, editToken: retry.data.editToken };
      saveShareCredentials(credentials);
      return { ok: true, id: credentials.id, editToken: credentials.editToken, url: buildShareUrl(credentials.id) };
    }
    return { ok: false, error: mapShareError(retry.status, retry.error) };
  }

  return { ok: false, error: mapShareError(first.status, first.error) };
}

/** Fetches a shared canvas by id, parsing its stored document JSON. */
export async function fetchSharedCanvas(
  id: string,
): Promise<{ ok: true; canvas: SharedCanvasPayload } | { ok: false; error: string }> {
  if (isOffline()) {
    return { ok: false, error: "You're offline — this link needs a network connection to load." };
  }

  let res: Response;
  try {
    res = await fetch(resolveApiUrl(`/api/canvas/${encodeURIComponent(id)}`), {
      method: "GET",
      signal: AbortSignal.timeout(SHARE_TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, error: `Couldn't reach the server: ${e instanceof Error ? e.message : "network error"}` };
  }

  if (!res.ok) {
    if (res.status === 503) {
      return { ok: false, error: "Canvas sharing isn't available on this server yet." };
    }
    if (res.status === 404) {
      return { ok: false, error: "This shared canvas doesn't exist or has been removed." };
    }
    return { ok: false, error: `Failed to load shared canvas (${res.status}).` };
  }

  try {
    const parsed = (await res.json()) as {
      id?: unknown;
      title?: unknown;
      document?: unknown;
      updatedAt?: unknown;
    };
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.title !== "string" ||
      typeof parsed.document !== "string" ||
      typeof parsed.updatedAt !== "string"
    ) {
      return { ok: false, error: "Shared canvas response was malformed." };
    }
    const data = deserializeDocument(parsed.document);
    return {
      ok: true,
      canvas: { id: parsed.id, title: parsed.title, data, updatedAt: parsed.updatedAt },
    };
  } catch (e) {
    return { ok: false, error: `Shared canvas could not be read: ${e instanceof Error ? e.message : "invalid response"}` };
  }
}

/** Deletes the current document's share, if any. Never throws. */
export async function unshareCurrentCanvas(): Promise<{ ok: true } | { ok: false; error: string }> {
  const credentials = loadShareCredentials();
  if (!credentials) {
    // Nothing to unshare is not an error — the end state (no share) is
    // already true.
    return { ok: true };
  }

  if (isOffline()) {
    return { ok: false, error: "You're offline — unsharing needs a network connection." };
  }

  let res: Response;
  try {
    // editToken travels in the JSON body, not the query string — a query
    // param lands verbatim in access/request logs, which would leak the
    // secret that's supposed to gate deletion.
    res = await fetch(resolveApiUrl(`/api/canvas/${encodeURIComponent(credentials.id)}`), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editToken: credentials.editToken }),
      signal: AbortSignal.timeout(SHARE_TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, error: `Couldn't reach the server: ${e instanceof Error ? e.message : "network error"}` };
  }

  // 204 (deleted) and 404 (already gone) both mean "no longer shared" from
  // the caller's perspective — clear local credentials either way.
  if (res.status === 204 || res.status === 404) {
    saveShareCredentials(null);
    return { ok: true };
  }

  if (res.status === 503) {
    return { ok: false, error: "Canvas sharing isn't available on this server yet." };
  }

  return { ok: false, error: `Failed to unshare (${res.status}).` };
}

/**
 * Turn the currently-open shared canvas into the viewer's own editable copy.
 *
 * The `/c/:id` viewer and the `/app` editor are two routes of the same SPA
 * behind one router, and the viewer has already loaded the shared document
 * into the live Zustand stores by the time this runs — so "fork" is nothing
 * more than flipping the session out of read-only view mode; there is no
 * second copy of the document to stage or fetch (unlike, say,
 * showcaseScreenHandoff.ts's cross-route handoff, which exists only because
 * the showcase and editor routes do NOT share live store state the way the
 * viewer and editor do here).
 *
 * Detaches from the original share's credentials (`saveShareCredentials(null)`)
 * so a subsequent "Share" click creates a fresh link instead of overwriting
 * — or, if the viewer somehow leaked an editToken it doesn't own, being
 * unable to overwrite — someone else's shared canvas. The route navigation
 * itself (`navigate("/app")`) is left to the UI layer; this module must not
 * depend on react-router.
 */
export function forkSharedCanvasInPlace(title: string): void {
  useEditorModeStore.getState().exitToEdit();
  useDocumentStore.getState().setFileName(`${title} (copy)`);
  saveShareCredentials(null);
}
