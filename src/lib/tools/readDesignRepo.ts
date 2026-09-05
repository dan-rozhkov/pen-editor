import type { ToolHandler } from "@/lib/toolRegistry";
import { postRepoRequest } from "./repoToolRequest";

// Client-executed: calls the backend's POST /api/repo/brief, which the
// backend's read_design_repo tool schema (pen-editor-backend/src/ai/tools.ts)
// declares with no `execute` — same split as every other client-executed tool
// (see the root CLAUDE.md's "split-execution AI design agent" section).
// The backend reads the target GitHub repo and returns a condensed "design
// brief": stack, design tokens, and a component inventory, so the model can
// decide what to fetch in full via read_repo_files rather than pulling whole
// files up front.

export const readDesignRepo: ToolHandler = async (args) => {
  const repo = typeof args.repo === "string" ? args.repo.trim() : "";
  if (!repo) {
    return JSON.stringify({
      error:
        'Missing "repo". Provide a GitHub repository, e.g. "owner/name" or a github.com URL.',
    });
  }
  const ref =
    typeof args.ref === "string" && args.ref.trim() ? args.ref.trim() : undefined;

  return postRepoRequest("read_design_repo", "/api/repo/brief", {
    repo,
    ...(ref ? { ref } : {}),
  });
};
