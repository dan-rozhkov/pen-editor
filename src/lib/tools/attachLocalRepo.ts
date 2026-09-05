import { useRepoContextStore, type LocalRepoFileInput } from "@/store/repoContextStore";
import type { ToolHandler } from "../toolRegistry";

// Client-executed. The backend schema (pen-editor-backend/src/ai/tools.ts)
// declares `attach_local_repo` with no `execute` and deliberately excludes
// it from the chat agent's own tool set — the only caller is an external
// agent driving this tab over WebMCP (Chrome extension, Playwright, CDP,
// Electron), which is the one surface that works on a deployed web build
// (the backend MCP endpoint is 503 in production). Once attached here,
// read_design_repo/read_repo_files (readDesignRepo.ts, readRepoFiles.ts)
// serve from repoContextStore instead of GitHub.
//
// The caller is a script driving the page, not the design agent itself —
// so every input is treated as untrusted and validated defensively rather
// than trusted the way an LLM tool call from the chat loop usually is.

function normalizeFiles(raw: unknown): LocalRepoFileInput[] | { error: string } {
  if (raw === undefined) return [];
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { error: '"files" was a string but could not be parsed as JSON.' };
    }
  }
  if (!Array.isArray(value)) {
    return { error: '"files" must be an array of {path, content} objects.' };
  }
  const files: LocalRepoFileInput[] = [];
  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as { path?: unknown }).path !== "string" ||
      typeof (entry as { content?: unknown }).content !== "string"
    ) {
      return { error: 'Every entry in "files" must be an object with string "path" and "content".' };
    }
    const path = (entry as { path: string }).path.trim();
    if (!path) {
      return { error: 'Every file entry must have a non-empty "path".' };
    }
    files.push({ path, content: (entry as { content: string }).content });
  }
  return files;
}

function normalizeTree(raw: unknown): string[] | { error: string } {
  if (raw === undefined) return [];
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { error: '"tree" was a string but could not be parsed as JSON.' };
    }
  }
  if (!Array.isArray(value)) {
    return { error: '"tree" must be an array of repo-relative path strings.' };
  }
  const tree: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return { error: 'Every entry in "tree" must be a string path.' };
    }
    const trimmed = entry.trim();
    if (trimmed) tree.push(trimmed);
  }
  return tree;
}

function describeState(): Record<string, unknown> {
  const state = useRepoContextStore.getState();
  if (state.name === null) {
    return { attached: false };
  }
  const bytesUsed = state.bytesUsed();
  return {
    attached: true,
    name: state.name,
    fileCount: state.filesByPath.size,
    treeSize: state.tree.length,
    bytesUsed,
  };
}

export const attachLocalRepo: ToolHandler = async (args) => {
  if (args.detach === true) {
    const dropped = useRepoContextStore.getState().detach();
    return JSON.stringify(
      dropped
        ? { ok: true, detached: true, name: dropped.name, fileCountDropped: dropped.fileCount }
        : { ok: true, detached: false, note: "No local repo was attached." }
    );
  }

  const name = typeof args.name === "string" ? args.name.trim() : "";
  const mode = args.mode === "append" ? "append" : "replace";

  const files = normalizeFiles(args.files);
  if ("error" in files) {
    return JSON.stringify({ ok: false, error: files.error });
  }
  const tree = normalizeTree(args.tree);
  if ("error" in tree) {
    return JSON.stringify({ ok: false, error: tree.error });
  }

  const store = useRepoContextStore.getState();

  if (mode === "append") {
    if (!store.isAttached()) {
      return JSON.stringify({
        ok: false,
        error: 'mode:"append" requires a repo already attached — call with mode:"replace" (or omit mode) first.',
      });
    }
    const result = store.appendFiles(files, tree);
    if (!result.ok) {
      return JSON.stringify({ ok: false, error: result.reason, ...describeState() });
    }
    return JSON.stringify({
      ok: true,
      mode,
      name: result.name,
      fileCount: result.fileCount,
      treeSize: result.treeSize,
      bytesUsed: result.bytesUsed,
      remainingBytes: result.remainingBytes,
      remainingFiles: result.remainingFiles,
      remainingTreePaths: result.remainingTreePaths,
    });
  }

  if (!name) {
    return JSON.stringify({
      ok: false,
      error: 'Missing "name". Provide a name for the repo being attached (e.g. a folder or project name).',
    });
  }

  const result = store.attach({ name, tree, files });
  if (!result.ok) {
    return JSON.stringify({ ok: false, error: result.reason });
  }
  return JSON.stringify({
    ok: true,
    mode,
    name: result.name,
    fileCount: result.fileCount,
    treeSize: result.treeSize,
    bytesUsed: result.bytesUsed,
    remainingBytes: result.remainingBytes,
    remainingFiles: result.remainingFiles,
    remainingTreePaths: result.remainingTreePaths,
  });
};
