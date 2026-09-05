import type { ToolHandler } from "@/lib/toolRegistry";
import { postRepoRequest } from "./repoToolRequest";

// Client-executed counterpart to readDesignRepo.ts — calls the backend's
// POST /api/repo/files, which fetches specific file contents out of a GitHub
// repo the model has already surveyed via read_design_repo. See that file's
// header comment for the split-execution context.

// Mirrors the backend schema's own cap (pen-editor-backend/src/ai/tools.ts),
// so an over-long request is rejected here with an actionable message instead
// of costing a round-trip to come back as a 400.
const MAX_PATHS = 20;

export const readRepoFiles: ToolHandler = async (args) => {
  const repo = typeof args.repo === "string" ? args.repo.trim() : "";
  if (!repo) {
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

  const ref =
    typeof args.ref === "string" && args.ref.trim() ? args.ref.trim() : undefined;

  return postRepoRequest("read_repo_files", "/api/repo/files", {
    repo,
    paths,
    ...(ref ? { ref } : {}),
  });
};
