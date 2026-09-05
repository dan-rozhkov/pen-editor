import type { ToolHandler } from "@/lib/toolRegistry";
import { useRepoContextStore } from "@/store/repoContextStore";
import { annotateIgnoredRepoArg, postRepoRequest } from "./repoToolRequest";

// Client-executed: calls the backend's POST /api/repo/brief, which the
// backend's read_design_repo tool schema (pen-editor-backend/src/ai/tools.ts)
// declares with no `execute` — same split as every other client-executed tool
// (see the root CLAUDE.md's "split-execution AI design agent" section).
// The backend reads the target GitHub repo and returns a condensed "design
// brief": stack, design tokens, and a component inventory, so the model can
// decide what to fetch in full via read_repo_files rather than pulling whole
// files up front.
//
// Second source: when an external agent has pushed a local repo into this
// tab via the `attach_local_repo` WebMCP tool (repoContextStore.ts), that
// attachment takes over from GitHub entirely — the `repo`/`ref` args are
// ignored, and the backend analyzes the pushed snapshot instead
// (POST /api/repo/brief-local). Only the files the analyzer actually reads
// are sent up; everything else the local repo carries stays in the browser.

// Basenames/suffixes the backend's design-brief analyzer reads
// (pen-editor-backend/src/services/repoDesignSystem.ts): package.json for
// framework/component-library detection, and a tailwind config for design
// tokens — both unconditional below. `tsconfig.json` is deliberately NOT
// sent: buildDesignBriefFromSource only ever pushes it onto `keyFiles` for
// display, it never calls `readFile("tsconfig.json")`, so sending its
// content here would cost bytes the analyzer can't spend. Kept narrow on
// purpose otherwise — sending the whole local snapshot here would defeat the
// point of only pushing a "brief" up to the backend.
const TAILWIND_CONFIG_RE = /^tailwind\.config\.(js|ts|cjs|mjs)$/;

function isUnconditionallyRelevant(path: string): boolean {
  const basename = path.split("/").pop() ?? path;
  return basename === "package.json" || TAILWIND_CONFIG_RE.test(basename);
}

// The analyzer (findGlobalCssPath) reads exactly ONE stylesheet — the first
// of these conventional paths present, falling back to the first *.css it
// sees at all. Sending every CSS file in the attachment on every brief call
// (the pre-fix behavior) re-POSTs files the analyzer will never look at;
// this mirrors its own preference order instead of guessing at a cap.
const GLOBAL_CSS_CANDIDATES = [
  "app/globals.css",
  "src/app/globals.css",
  "src/index.css",
  "src/app.css",
  "styles/globals.css",
];
const MAX_CSS_FILES_SENT = 1;

function selectCssPaths(attachedPaths: string[]): string[] {
  const cssPaths = attachedPaths.filter((p) => p.endsWith(".css"));
  if (cssPaths.length === 0) return [];
  const preferred = GLOBAL_CSS_CANDIDATES.find((candidate) => cssPaths.includes(candidate));
  if (preferred) return [preferred];
  return cssPaths.slice(0, MAX_CSS_FILES_SENT);
}

export const readDesignRepo: ToolHandler = async (args) => {
  const repoState = useRepoContextStore.getState();
  const repoArg = typeof args.repo === "string" ? args.repo.trim() : "";

  if (repoState.isAttached()) {
    const attachedPaths = Array.from(repoState.filesByPath.keys());
    const cssPathsToSend = new Set(selectCssPaths(attachedPaths));
    const relevantFiles = attachedPaths
      .filter((path) => isUnconditionallyRelevant(path) || cssPathsToSend.has(path))
      .map((path) => ({ path, content: repoState.filesByPath.get(path) as string }));

    // Attaching wins over an explicit `repo` argument deliberately — the
    // user attached it on purpose — but a silently-ignored argument that
    // happens to name a real, different repository is confusing. Report it
    // rather than pretending the argument was never sent.
    const raw = await postRepoRequest("read_design_repo", "/api/repo/brief-local", {
      name: repoState.name,
      tree: repoState.tree,
      files: relevantFiles,
    });
    return annotateIgnoredRepoArg(raw, repoArg);
  }

  const repo = repoArg;
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
