import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  DEFAULT_DOC_TITLE,
  createDoc,
  deleteDoc,
  dropStaleIndexEntry,
  listDocs,
  readDoc,
  repairDocIndex,
  subscribeDocs,
  updateDoc,
  type Doc,
  type DocChange,
  type DocMeta,
} from "@/lib/docs/docStore";
import { isDesktopDocsReady, whenDesktopDocsReady } from "@/lib/docs/desktopDocMirror";

const SAVE_DELAY_MS = 300;
/** Longest an edit may stay unsaved while the user keeps typing. */
const SAVE_MAX_WAIT_MS = 1000;

const CONFLICT_MESSAGE = "The agent changed this document. Your last edits were replaced.";
const STORAGE_FAILURE_MESSAGE = "Could not save the document: browser storage is full or blocked.";
const DELETED_MESSAGE = "This document was deleted.";
const UNREADABLE_MESSAGE = "This document cannot be read.";

/** Edits not yet written: markdown and/or title of one document. */
interface Pending {
  id: string;
  markdown?: string;
  title?: string;
}

/**
 * Applies a change to the document list without re-reading storage. `updatedAt`
 * only orders the list. A change that leaves the newest entry's title as it is
 * (our own autosave) keeps the same array.
 */
function applyChangeToList(prev: DocMeta[], change: DocChange): DocMeta[] {
  if (change.deleted) return prev.some((m) => m.id === change.id) ? prev.filter((m) => m.id !== change.id) : prev;
  const doc = change.doc;
  if (!doc) return listDocs();
  if (prev[0]?.id === doc.id && prev[0].title === doc.title) return prev;
  const meta: DocMeta = { id: doc.id, title: doc.title, updatedAt: doc.updatedAt };
  return [meta, ...prev.filter((m) => m.id !== doc.id)].sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface DocSync {
  docs: DocMeta[];
  /** Selected document id, or null when no documents exist. */
  id: string | null;
  title: string;
  /** Id the editor content belongs to; use as the editor `key` (lags `id` by one render). */
  editorId: string | null;
  /** Markdown the editor should show for `id` right now. */
  markdown: string;
  /** Bumps whenever `markdown` was replaced from outside (agent, other tab). */
  revision: number;
  select: (id: string) => void;
  create: () => void;
  remove: () => void;
  setTitle: (title: string) => void;
  /** The editor reports its current markdown on every user edit (debounced save). */
  onEditorMarkdown: (markdown: string) => void;
  /** The editor reports the markdown it holds after an external replace, so the echo check stays exact. */
  onEditorSynced: (markdown: string) => void;
}

/**
 * Editor-agnostic document state for /doc: selection via `?id=`, debounced
 * autosave of editor edits, and live replacement from agent writes. Kept free
 * of Tiptap so it is testable without a DOM editor.
 */
export function useDocSync(): DocSync {
  const [params, setParams] = useSearchParams();
  const [docs, setDocs] = useState<DocMeta[]>(() => listDocs());
  const paramId = params.get("id");
  const wantsNew = params.get("new") === "1";
  // An id the index does not list is checked against its body once per id (not on
  // every render): a readable body is repaired into the index below and opened even
  // if the repair fails; anything else falls back to the newest document.
  const inIndex = !!paramId && docs.some((d) => d.id === paramId);
  const orphanBody = useMemo(() => (paramId && !inIndex ? readDoc(paramId).kind : null), [paramId, inIndex]);
  const resolvedParam = paramId && (inIndex || orphanBody === "ok") ? paramId : null;
  // Desktop: disk documents may still be on their way in. Until the startup reconcile
  // ends nothing is picked (not `?id=`, not the newest) and the URL is not rewritten;
  // without a mirror this is ready at once.
  const [mirrorReady, setMirrorReady] = useState(isDesktopDocsReady);
  useEffect(() => {
    if (mirrorReady) return;
    let live = true;
    void whenDesktopDocsReady().then(() => {
      if (!live) return;
      setMirrorReady(true);
      setDocs(listDocs());
    });
    return () => {
      live = false;
    };
  }, [mirrorReady]);
  const id = mirrorReady ? ((resolvedParam ?? docs[0]?.id) ?? null) : null;

  const [loaded, setLoaded] = useState(() => {
    const read = id ? readDoc(id) : null;
    return { id, doc: read?.kind === "ok" ? read.doc : null, revision: 0 };
  });
  const [title, setTitleState] = useState(loaded.doc?.title ?? "");

  const idRef = useRef(id);
  // The stored version this editor last adopted or saved: the compare-and-set base.
  const baseRevRef = useRef(loaded.doc?.rev ?? 0);
  const baseMarkdownRef = useRef(loaded.doc?.markdown ?? "");
  const pendingRef = useRef<Pending | null>(null);
  // Newest foreign version that arrived while an edit was pending; the save resolves it.
  const latestRemoteRef = useRef<Doc | null>(null);
  const storageFailing = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Take a stored version as the new base. The editor is replaced only if its text differs.
  const adoptDoc = useCallback((doc: Doc, replaceEditor = false) => {
    pendingRef.current = null;
    latestRemoteRef.current = null;
    baseRevRef.current = doc.rev;
    setTitleState(doc.title);
    if (!replaceEditor && doc.markdown === baseMarkdownRef.current) return;
    baseMarkdownRef.current = doc.markdown;
    setLoaded((prev) => ({ id: doc.id, doc, revision: prev.revision + 1 }));
  }, []);

  // The body is gone or unreadable although we hold edits for it.
  const handleUnwritableDoc = useCallback((docId: string) => {
    pendingRef.current = null;
    if (readDoc(docId).kind === "missing") {
      toast(DELETED_MESSAGE);
      // Drops a stale index entry only (never a body), so the selection falls back.
      dropStaleIndexEntry(docId);
    } else {
      toast.error(UNREADABLE_MESSAGE);
    }
  }, []);

  const clearSaveTimers = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (maxTimer.current) clearTimeout(maxTimer.current);
    saveTimer.current = maxTimer.current = null;
  }, []);

  /** Writes the pending edit with compare-and-set on the base rev. Returns false only when storage rejected it (the edit stays pending). */
  const save = useCallback((): boolean => {
    clearSaveTimers();
    // Loops again only to re-apply a title edit on top of an equal-content conflict.
    // Bounded: a writer that keeps winning the race gets the last word.
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = pendingRef.current;
      if (!p) return true;
      if (p.id !== idRef.current) {
        pendingRef.current = null;
        return true;
      }
      // A message can outrun this page's localStorage cache, so a remote rev seen
      // there counts as a conflict even when the stored read still shows our base.
      const remote = latestRemoteRef.current?.id === p.id ? latestRemoteRef.current : null;
      let result: ReturnType<typeof updateDoc>;
      if (remote && remote.rev > baseRevRef.current) {
        result = "conflict";
      } else {
        try {
          const patch = { ...(p.markdown !== undefined ? { markdown: p.markdown } : {}), ...(p.title !== undefined ? { title: p.title } : {}) };
          result = updateDoc(p.id, patch, "editor", { expectedRev: baseRevRef.current });
        } catch {
          // Keep the pending edit; tell the user once per failure streak.
          if (!storageFailing.current) {
            storageFailing.current = true;
            toast.error(STORAGE_FAILURE_MESSAGE);
          }
          return false;
        }
      }
      storageFailing.current = false;
      if (result === null) {
        handleUnwritableDoc(p.id);
        return true;
      }
      if (result !== "conflict") {
        baseRevRef.current = result.rev;
        baseMarkdownRef.current = result.markdown;
        if (pendingRef.current === p) pendingRef.current = null;
        return true;
      }
      const read = readDoc(p.id);
      const stored = read.kind === "ok" ? read.doc : null;
      const doc = remote && (!stored || remote.rev >= stored.rev) ? remote : stored;
      if (!doc) {
        handleUnwritableDoc(p.id);
        return true;
      }
      if (p.markdown === undefined || p.markdown === doc.markdown) {
        // Same content: adopt the stored rev silently, then re-apply a title edit that differs.
        latestRemoteRef.current = null;
        baseRevRef.current = doc.rev;
        baseMarkdownRef.current = doc.markdown;
        if (p.title !== undefined && p.title !== doc.title) {
          pendingRef.current = { id: p.id, title: p.title };
          continue;
        }
        pendingRef.current = null;
        setTitleState(doc.title);
        return true;
      }
      adoptDoc(doc, true);
      toast(CONFLICT_MESSAGE);
      return true;
    }
    pendingRef.current = null;
    return true;
  }, [adoptDoc, clearSaveTimers, handleUnwritableDoc]);

  const flush = save;

  // Load a (new) selection into state. Runs on id change only. Pending edits never
  // survive a switch: if the flush fails the user has just been warned.
  useEffect(() => {
    if (idRef.current === id) return;
    if (!flush()) pendingRef.current = null;
    idRef.current = id;
    const read = id ? readDoc(id) : null;
    const doc = read?.kind === "ok" ? read.doc : null;
    baseMarkdownRef.current = doc?.markdown ?? "";
    baseRevRef.current = doc?.rev ?? 0;
    latestRemoteRef.current = null;
    setLoaded((prev) => ({ id, doc, revision: prev.revision + 1 }));
    setTitleState(doc?.title ?? "");
  }, [id, flush]);

  // Creates a document and selects it, keeping every other param and dropping `new`.
  const createAndSelectNewDoc = useCallback(() => {
    flush();
    let doc: Doc;
    try {
      doc = createDoc({ title: DEFAULT_DOC_TITLE }, "editor");
    } catch {
      toast.error(STORAGE_FAILURE_MESSAGE);
      return;
    }
    setDocs(listDocs());
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete("new");
        next.set("id", doc.id);
        return next;
      },
      { replace: true },
    );
  }, [flush, setParams]);

  // "/doc?new=1": create exactly one document (StrictMode runs effects twice).
  const creatingNew = useRef(false);
  useEffect(() => {
    if (!wantsNew) {
      creatingNew.current = false;
      return;
    }
    if (creatingNew.current) return;
    creatingNew.current = true;
    createAndSelectNewDoc();
  }, [wantsNew, createAndSelectNewDoc]);

  // Keep the URL pointing at the resolved document (no id, or a stale one).
  useEffect(() => {
    if (id && paramId !== id && !wantsNew) {
      const next = new URLSearchParams(params);
      next.set("id", id);
      setParams(next, { replace: true });
    }
  }, [id, paramId, wantsNew, params, setParams]);

  useEffect(() => {
    const unsubscribe = subscribeDocs((change) => {
      setDocs((prev) => applyChangeToList(prev, change));
      if (change.id !== idRef.current) return;
      if (change.deleted) {
        // The effect above resolves the fallback; drop pending writes to a dead doc.
        pendingRef.current = null;
        setParams((p) => {
          const next = new URLSearchParams(p);
          next.delete("id");
          return next;
        }, { replace: true });
        return;
      }
      // `source` is informational: the rev alone says whether this is news. A copy
      // at or below our base is a duplicate delivery, a stale copy or our own save.
      let doc = change.doc;
      if (!doc) {
        const read = readDoc(change.id);
        if (read.kind !== "ok") return;
        doc = read.doc;
      }
      if (doc.rev <= baseRevRef.current) return;
      if (pendingRef.current?.id === doc.id) {
        // A pending local edit is resolved by the compare-and-set at save time.
        latestRemoteRef.current = doc;
        return;
      }
      adoptDoc(doc);
    });
    return () => {
      unsubscribe();
      flush();
    };
  }, [flush, setParams, adoptDoc]);

  // A readable body whose index entry is missing gets the entry back instead of being
  // skipped. Once per id: a failed repair is not retried on every render.
  useEffect(() => {
    if (paramId && orphanBody === "ok") repairDocIndex(paramId);
  }, [paramId, orphanBody]);

  // Cmd+W / reload / tab hidden: do not lose the last debounce window.
  useEffect(() => {
    const onHide = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush]);

  const select = useCallback(
    (next: string) => {
      flush();
      const p = new URLSearchParams(params);
      p.set("id", next);
      setParams(p, { replace: true });
    },
    [flush, params, setParams],
  );

  const create = createAndSelectNewDoc;

  const remove = useCallback(() => {
    if (idRef.current) deleteDoc(idRef.current, "editor");
  }, []);

  // Debounce restarts on every keystroke; the max wait bounds the unsaved window.
  const schedule = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, SAVE_DELAY_MS);
    if (!maxTimer.current) maxTimer.current = setTimeout(save, SAVE_MAX_WAIT_MS);
  }, [save]);

  const setTitle = useCallback(
    (next: string) => {
      setTitleState(next);
      const current = idRef.current;
      if (!current) return;
      pendingRef.current = { ...(pendingRef.current?.id === current ? pendingRef.current : { id: current }), title: next };
      schedule();
    },
    [schedule],
  );

  const onEditorMarkdown = useCallback(
    (markdown: string) => {
      const current = idRef.current;
      if (!current) return;
      pendingRef.current = { ...(pendingRef.current?.id === current ? pendingRef.current : { id: current }), markdown };
      schedule();
    },
    [schedule],
  );

  // The editor reports the (normalized) text it holds after an external replace.
  const onEditorSynced = useCallback((markdown: string) => {
    baseMarkdownRef.current = markdown;
  }, []);

  useEffect(() => {
    document.title = title.trim() || "Document";
  }, [title]);

  return {
    docs,
    id,
    title,
    editorId: loaded.id,
    markdown: loaded.doc?.markdown ?? "",
    revision: loaded.revision,
    select,
    create,
    remove,
    setTitle,
    onEditorMarkdown,
    onEditorSynced,
  };
}
