import { postRepoRequest } from "@/lib/tools/repoToolRequest";
import type { RepoDesignTokens } from "./designTokensToVariables";

export type RepoTokensResult =
  | { ok: true; repo: string; tokens: RepoDesignTokens; briefNotes: string[] }
  | { ok: false; error: string };

/** Same transport as the read_design_repo tool: POST /api/repo/brief. */
export async function fetchRepoTokens(repo: string): Promise<RepoTokensResult> {
  const name = repo.trim();
  if (!name) return { ok: false, error: 'Enter a repository, e.g. "shadcn-ui/ui".' };
  const raw = await postRepoRequest("read_design_repo", "/api/repo/brief", { repo: name });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The backend answered with something unreadable." };
  }
  const record = body as { error?: unknown; tokens?: unknown; notes?: unknown; repo?: { owner?: string; name?: string } };
  if (typeof record.error === "string") return { ok: false, error: record.error };
  if (!record.tokens || typeof record.tokens !== "object") {
    return { ok: false, error: "The brief has no design tokens." };
  }
  const label = record.repo?.owner && record.repo?.name ? `${record.repo.owner}/${record.repo.name}` : name;
  const briefNotes = Array.isArray(record.notes) ? record.notes.filter((n): n is string => typeof n === "string") : [];
  return { ok: true, repo: label, tokens: record.tokens as RepoDesignTokens, briefNotes };
}
