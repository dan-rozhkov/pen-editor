import { create } from "zustand";

/**
 * The local-repo counterpart to the GitHub-backed `read_design_repo` /
 * `read_repo_files` tools (src/lib/tools/readDesignRepo.ts,
 * readRepoFiles.ts). A local repo is not fetched by this app at all — an
 * external agent driving the tab over WebMCP (Chrome extension, Playwright,
 * CDP, Electron) pushes it in via the `attach_local_repo` tool handler
 * (src/lib/tools/attachLocalRepo.ts), which is the only writer of this
 * store. Once attached, the two repo tools serve from here instead of
 * GitHub — see their header comments for the routing.
 *
 * Deliberately in-memory only: no persistence middleware, no localStorage.
 * This is someone's source code passed through a live session; it should
 * disappear with the tab, not survive a reload or leak into another
 * session's storage.
 */

export interface LocalRepoFileInput {
  path: string;
  content: string;
}

/** A cap was hit. `reason` is meant to be read by the pushing agent, not just logged. */
export interface RepoCapRejection {
  ok: false;
  reason: string;
}

export interface RepoAttachSuccess {
  ok: true;
  name: string;
  fileCount: number;
  treeSize: number;
  bytesUsed: number;
  remainingBytes: number;
  remainingFiles: number;
  remainingTreePaths: number;
}

export type RepoAttachResult = RepoAttachSuccess | RepoCapRejection;

// Per-call caps: rejecting a single oversized push outright is cheaper for
// the caller to react to than accepting it and failing later on the
// attachment-wide cap.
export const MAX_CALL_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_CALL_FILES = 500;

// Attachment-wide caps: this is a browser tab, not a checkout on disk — the
// whole point is that the analyzer/read tools only ever need a slice of a
// repo, so these are generous for that slice, not for a full mirror.
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_ATTACHMENT_FILES = 2000;
export const MAX_ATTACHMENT_TREE_PATHS = 20000;

function byteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

// A path from the pushing agent is untrusted (see attachLocalRepo.ts's own
// comment) — reject anything that isn't a plain repo-relative path before it
// ever reaches `filesByPath`, mirroring the backend's `safeRelativePath`
// (pen-editor-backend/src/routes/repo.ts) so a local attachment can't attach
// what a GitHub-backed request would 400 on. This also matters for a reason
// the backend doesn't share: `filesByPath` and `tree` are what
// read_design_repo/read_repo_files serve straight out of the store, so an
// unvalidated ".." here would resolve outside the "repo" entirely, and an
// unvalidated leading "/" would collide with how those callers build paths.
function invalidPathReason(path: string): string | null {
  if (path.startsWith("/")) return `starts with "/" — paths must be repo-relative`;
  if (/(^|\/)\.\.($|\/)/.test(path)) return `contains a ".." segment`;
  return null;
}

function checkPaths(files: LocalRepoFileInput[], tree: string[]): RepoCapRejection | null {
  for (const file of files) {
    const reason = invalidPathReason(file.path);
    if (reason) {
      return { ok: false, reason: `Rejected file path "${file.path}": ${reason}.` };
    }
  }
  for (const path of tree) {
    const reason = invalidPathReason(path);
    if (reason) {
      return { ok: false, reason: `Rejected tree path "${path}": ${reason}.` };
    }
  }
  return null;
}

interface RepoContextState {
  /** Name of the attached repo (e.g. "owner/name" or a local folder name), or null if nothing is attached. */
  name: string | null;
  /** Repo-relative paths, for structural/listing purposes — not every path here has content in `filesByPath`. */
  tree: string[];
  /**
   * path -> file content, for the subset of files actually pushed. A `Map`,
   * not a plain object: a plain object indexed by an attacker-controlled key
   * (`constructor`, `__proto__`, `toString`, `hasOwnProperty`, ...) either
   * silently resolves to `Object.prototype`'s own value instead of `undefined`
   * (a `read_repo_files({paths:["constructor"]})` returning a function's
   * source) or writes through the prototype instead of the object (an
   * attached `__proto__` file vanishing from lookups while still counting
   * toward `bytesUsed`). A `Map` has no prototype chain to collide with.
   */
  filesByPath: Map<string, string>;
  /** Epoch ms when the current attachment was created (by `attach`), or null. */
  attachedAt: number | null;

  /** Total content bytes currently held across `filesByPath`. */
  bytesUsed: () => number;
  /** Whether a local repo is currently attached. */
  isAttached: () => boolean;
  /** Read one file's content by exact path, or undefined if not present. */
  getFile: (path: string) => string | undefined;

  /**
   * Replace any current attachment with a fresh one. Rejected (without
   * mutating state) if the incoming payload alone exceeds a per-call or
   * attachment-wide cap.
   */
  attach: (input: {
    name: string;
    tree?: string[];
    files?: LocalRepoFileInput[];
  }) => RepoAttachResult;

  /**
   * Add files (and optionally more tree paths) to the current attachment —
   * this is how a large repo is pushed in chunks. Errors, rather than
   * silently truncating, if nothing is attached yet or a cap would be
   * exceeded; the existing attachment is left untouched on rejection.
   */
  appendFiles: (files: LocalRepoFileInput[], tree?: string[]) => RepoAttachResult;

  /** Clear the attachment. Returns what was dropped, or null if nothing was attached. */
  detach: () => { name: string; fileCount: number } | null;
}

export const useRepoContextStore = create<RepoContextState>((set, get) => ({
  name: null,
  tree: [],
  filesByPath: new Map(),
  attachedAt: null,

  bytesUsed: () => {
    const { filesByPath } = get();
    let total = 0;
    for (const content of filesByPath.values()) {
      total += byteLength(content);
    }
    return total;
  },

  isAttached: () => get().name !== null,

  getFile: (path) => get().filesByPath.get(path),

  attach: ({ name, tree = [], files = [] }) => {
    const callRejection = checkCallCaps(files);
    if (callRejection) return callRejection;

    const pathRejection = checkPaths(files, tree);
    if (pathRejection) return pathRejection;

    const dedupedTree = Array.from(new Set(tree));
    if (dedupedTree.length > MAX_ATTACHMENT_TREE_PATHS) {
      return {
        ok: false,
        reason: `Tree has ${dedupedTree.length} paths, over the ${MAX_ATTACHMENT_TREE_PATHS}-path attachment cap. Send a pruned tree (skip node_modules/build output/lockfiles).`,
      };
    }
    // Build the map first (so a duplicate path in this same call collapses
    // to one entry, same as appendFiles) and derive every count/byte figure
    // from it afterwards — never from `files.length`/a sum over `files`,
    // which double-counts a duplicate path and would report a `bytesUsed`
    // that contradicts the `fileCount` in the same response.
    const filesByPath = new Map<string, string>();
    for (const file of files) {
      filesByPath.set(file.path, file.content);
    }
    if (filesByPath.size > MAX_ATTACHMENT_FILES) {
      return {
        ok: false,
        reason: `${filesByPath.size} files exceeds the ${MAX_ATTACHMENT_FILES}-file attachment cap. Attach fewer files, or use appendFiles across multiple calls up to the cap.`,
      };
    }
    let bytesUsed = 0;
    for (const content of filesByPath.values()) {
      bytesUsed += byteLength(content);
    }
    if (bytesUsed > MAX_ATTACHMENT_BYTES) {
      return {
        ok: false,
        reason: `Attachment would use ${bytesUsed} bytes, over the ${MAX_ATTACHMENT_BYTES}-byte cap. Attach fewer/smaller files.`,
      };
    }

    set({ name, tree: dedupedTree, filesByPath, attachedAt: Date.now() });
    return {
      ok: true,
      name,
      fileCount: filesByPath.size,
      treeSize: dedupedTree.length,
      bytesUsed,
      remainingBytes: MAX_ATTACHMENT_BYTES - bytesUsed,
      remainingFiles: MAX_ATTACHMENT_FILES - filesByPath.size,
      remainingTreePaths: MAX_ATTACHMENT_TREE_PATHS - dedupedTree.length,
    };
  },

  appendFiles: (files, tree = []) => {
    const state = get();
    if (state.name === null) {
      return {
        ok: false,
        reason: 'No repo is currently attached — mode:"append" requires a prior attach() call. Attach first.',
      };
    }

    const callRejection = checkCallCaps(files);
    if (callRejection) return callRejection;

    const pathRejection = checkPaths(files, tree);
    if (pathRejection) return pathRejection;

    const mergedTree = Array.from(new Set([...state.tree, ...tree]));
    if (mergedTree.length > MAX_ATTACHMENT_TREE_PATHS) {
      return {
        ok: false,
        reason: `Appending would grow the tree to ${mergedTree.length} paths, over the ${MAX_ATTACHMENT_TREE_PATHS}-path attachment cap. Send fewer new paths.`,
      };
    }
    const mergedFiles = new Map(state.filesByPath);
    for (const file of files) {
      mergedFiles.set(file.path, file.content);
    }
    const fileCount = mergedFiles.size;
    if (fileCount > MAX_ATTACHMENT_FILES) {
      return {
        ok: false,
        reason: `Appending would grow the attachment to ${fileCount} files, over the ${MAX_ATTACHMENT_FILES}-file cap. Send fewer new files.`,
      };
    }
    let bytesUsed = 0;
    for (const content of mergedFiles.values()) {
      bytesUsed += byteLength(content);
    }
    if (bytesUsed > MAX_ATTACHMENT_BYTES) {
      return {
        ok: false,
        reason: `Appending would grow the attachment to ${bytesUsed} bytes, over the ${MAX_ATTACHMENT_BYTES}-byte cap. Send fewer/smaller files.`,
      };
    }

    set({ tree: mergedTree, filesByPath: mergedFiles });
    return {
      ok: true,
      name: state.name,
      fileCount,
      treeSize: mergedTree.length,
      bytesUsed,
      remainingBytes: MAX_ATTACHMENT_BYTES - bytesUsed,
      remainingFiles: MAX_ATTACHMENT_FILES - fileCount,
      remainingTreePaths: MAX_ATTACHMENT_TREE_PATHS - mergedTree.length,
    };
  },

  detach: () => {
    const { name, filesByPath } = get();
    if (name === null) return null;
    const fileCount = filesByPath.size;
    set({ name: null, tree: [], filesByPath: new Map(), attachedAt: null });
    return { name, fileCount };
  },
}));

function checkCallCaps(files: LocalRepoFileInput[]): RepoCapRejection | null {
  if (files.length > MAX_CALL_FILES) {
    return {
      ok: false,
      reason: `This call sent ${files.length} files, over the ${MAX_CALL_FILES}-file per-call cap. Split across multiple calls.`,
    };
  }
  let callBytes = 0;
  for (const file of files) {
    callBytes += byteLength(file.content);
  }
  if (callBytes > MAX_CALL_BYTES) {
    return {
      ok: false,
      reason: `This call sent ${callBytes} bytes, over the ${MAX_CALL_BYTES}-byte per-call cap. Send smaller/fewer files per call.`,
    };
  }
  return null;
}

/** Selector: is a local repo currently attached? */
export function selectIsLocalRepoAttached(state: RepoContextState): boolean {
  return state.name !== null;
}

/** Selector factory: read one file's content by exact path. */
export function selectLocalRepoFile(path: string) {
  return (state: RepoContextState): string | undefined => state.filesByPath.get(path);
}
