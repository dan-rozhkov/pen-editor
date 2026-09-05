import type { ToolHandler } from "@/lib/toolRegistry";
import { useRepoContextStore } from "@/store/repoContextStore";
import { postRepoRequest } from "./repoToolRequest";

// Client-executed counterpart to readDesignRepo.ts — calls the backend's
// POST /api/repo/files, which fetches specific file contents out of a GitHub
// repo the model has already surveyed via read_design_repo. See that file's
// header comment for the split-execution context.
//
// Second source: when a local repo is attached (repoContextStore.ts, pushed
// in via the `attach_local_repo` WebMCP tool), this makes no network call at
// all — the files already live in the browser, so they are served straight
// out of the store in the same `{repo, files, missing}` shape the backend
// returns, including the backend's own 64KB-per-file truncation.

// Mirrors the backend schema's own cap (pen-editor-backend/src/ai/tools.ts),
// so an over-long request is rejected here with an actionable message instead
// of costing a round-trip to come back as a 400.
const MAX_PATHS = 20;

// Mirrors pen-editor-backend/src/routes/repo.ts's MAX_FILE_BYTES/
// MAX_RESPONSE_BYTES and pen-editor-backend/src/services/repoFiles.ts's
// TRUNCATION_MARKER/fetchFilesWithBudget, so a model reading a local file
// sees the same shape/behavior as one reading a GitHub file: a per-file cap
// AND a whole-response budget shared across every path in the call, with
// whatever the budget ran out before reading reported in `notRead` rather
// than silently returned as a multi-megabyte response.
const MAX_FILE_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const TRUNCATION_MARKER = "\n/* ... truncated ... */";

// Same "back off to the last complete UTF-8 code point" trick as the
// backend's truncateUtf8, translated to Web APIs (no Buffer in the browser).
// TextDecoder's `{ stream: true }` buffers an incomplete trailing sequence
// internally and omits it from the output.
function truncateUtf8(content: string, maxBytes: number): { text: string; bytes: number } {
  const encoder = new TextEncoder();
  const full = encoder.encode(content);
  if (full.byteLength <= maxBytes) {
    return { text: content, bytes: full.byteLength };
  }
  const decoder = new TextDecoder("utf-8");
  const text = decoder.decode(full.subarray(0, maxBytes), { stream: true });
  return { text, bytes: encoder.encode(text).byteLength };
}

interface LocalFileResult {
  path: string;
  content: string;
  truncated: boolean;
  bytes: number;
}

function readFromLocalRepo(paths: string[], ignoredRepoArg: string): string {
  const state = useRepoContextStore.getState();
  const files: LocalFileResult[] = [];
  const missing: string[] = [];
  // Distinct from `missing`: a path in here exists in the attachment but
  // reading it was cut short by the shared response budget, same
  // files-vs-notRead-vs-missing three-way split fetchFilesWithBudget reports
  // for the GitHub path — a model needs to tell "this file doesn't exist"
  // apart from "this call's budget ran out before reaching it".
  const notRead: string[] = [];
  let remainingBudget = MAX_RESPONSE_BYTES;
  const encoder = new TextEncoder();

  for (const path of paths) {
    const content = state.filesByPath.get(path);
    if (content === undefined) {
      missing.push(path);
      continue;
    }
    if (remainingBudget <= 0) {
      notRead.push(path);
      continue;
    }
    const fullBytes = encoder.encode(content).byteLength;
    const cap = Math.max(0, Math.min(MAX_FILE_BYTES, remainingBudget));
    let outContent = content;
    let truncated = false;
    if (fullBytes > cap) {
      outContent = truncateUtf8(content, cap).text + TRUNCATION_MARKER;
      truncated = true;
    }
    // `bytes` counts the truncation marker too when present, matching the
    // backend's fetchFilesWithBudget (it measures `outContent`, not the
    // pre-marker text) — a model must not be able to tell the two sources
    // apart from this field's meaning.
    const outBytes = encoder.encode(outContent).byteLength;
    remainingBudget = Math.max(0, remainingBudget - outBytes);
    files.push({ path, content: outContent, truncated, bytes: outBytes });
  }

  return JSON.stringify({
    source: "local",
    repo: { name: state.name },
    files,
    missing,
    // Always present, even when empty, matching the backend's response
    // shape exactly — a model must not be able to tell which source
    // answered from the shape of the JSON, only from `source`.
    notRead,
    ...(ignoredRepoArg ? { ignoredRepoArg } : {}),
  });
}

export const readRepoFiles: ToolHandler = async (args) => {
  const repoState = useRepoContextStore.getState();
  const repo = typeof args.repo === "string" ? args.repo.trim() : "";
  if (!repo && !repoState.isAttached()) {
    return JSON.stringify({
      error:
        'Missing "repo". Provide a GitHub repository, e.g. "owner/name" or a github.com URL.',
    });
  }

  // A model that stringifies the array instead of emitting it is common
  // enough that publishToShowcase.ts already accepts the same shape — costing
  // a whole tool step to say "send it as an array" is not worth the purity.
  let rawPaths = args.paths;
  if (typeof rawPaths === "string") {
    try {
      rawPaths = JSON.parse(rawPaths);
    } catch {
      return JSON.stringify({
        error: '"paths" was a string but could not be parsed as JSON.',
      });
    }
  }
  if (!Array.isArray(rawPaths)) {
    return JSON.stringify({
      error: '"paths" must be an array of file path strings.',
    });
  }
  // Trimmed on the way out, not just for the check: a path carrying a
  // trailing newline 404s on GitHub and comes back in `missing`, telling the
  // model a file that exists does not.
  const paths = rawPaths
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim());
  if (paths.length === 0) {
    return JSON.stringify({
      error: '"paths" must contain at least one non-empty file path.',
    });
  }
  if (paths.length > MAX_PATHS) {
    return JSON.stringify({
      error: `Too many paths (${paths.length}). Request at most ${MAX_PATHS} files per call — split the request across multiple calls.`,
    });
  }

  if (repoState.isAttached()) {
    // The attachment wins deliberately — the user attached it on purpose —
    // but a `repo` argument silently dropped on the floor is confusing when
    // it happens to name a real, different repository. Report it rather
    // than pretending the argument was never sent.
    return readFromLocalRepo(paths, repo);
  }

  const ref =
    typeof args.ref === "string" && args.ref.trim() ? args.ref.trim() : undefined;

  return postRepoRequest("read_repo_files", "/api/repo/files", {
    repo,
    paths,
    ...(ref ? { ref } : {}),
  });
};
