// Desktop shell only: mirrors the markdown documents (docStore, localStorage) to
// disk through the shell's IPC bridge and reconciles both copies at startup.
// localStorage stays the synchronous working copy; disk is the durable one.
// On the web there is no bridge and every function here is a no-op.
// The mechanics live in desktopMirrorCore.ts (shared with the workflow mirror).

import type { DesktopDocsDiskApi } from "@/lib/desktopBridge";
import { createMirror, type DiskBridgeOf } from "@/lib/desktopMirrorCore";
import { deleteDoc, getDoc, importDoc, listDocs, parseDoc, pruneTombstones, readTombstones, setDocPersistence, upgradeLegacyRev, type Doc } from "@/lib/docs/docStore";

type DiskBridge = Required<DesktopDocsDiskApi>;

function isComplete(docs: DesktopDocsDiskApi | undefined): docs is DiskBridge {
  return !!docs && typeof docs.list === "function" && typeof docs.save === "function" && typeof docs.remove === "function";
}

/** The shell's disk store: the agent panel's first, then the desktop tab's. Undefined on the web or on an older shell. */
export function getDesktopDocsBridge(): DiskBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const panel = window.penAgentPanel?.docs;
  if (isComplete(panel)) return panel;
  const tab = window.penDesktop?.docs;
  return isComplete(tab) ? tab : undefined;
}

const mirror = createMirror<Doc>({
  name: "desktopDocMirror",
  noun: "document",
  listKey: "docs",
  getBridge: () => getDesktopDocsBridge() as DiskBridgeOf<Doc> | undefined,
  parse: parseDoc,
  ids: () => listDocs().map((meta) => meta.id),
  get: getDoc,
  import: importDoc,
  delete: (id) => deleteDoc(id, "editor", { persist: false }),
  upgradeLegacyRev,
  setPersistence: setDocPersistence,
  tombstones: { read: readTombstones, prune: pruneTombstones },
});

/** True when the startup reconcile is over or the mirror was never started on this page. */
export const isDesktopDocsReady = mirror.isReady;

/** Resolves after the startup reconcile finished or failed; at once when this page has no mirror. Never rejects. */
export const whenDesktopDocsReady = mirror.whenReady;

/** Starts the disk mirror once per page. Resolves when the startup reconcile is done; never rejects. */
export const startDesktopDocMirror = mirror.start;

/** Test seam: forgets the started mirror and removes its sink. */
export const resetDesktopDocMirrorForTests = mirror.resetForTests;
