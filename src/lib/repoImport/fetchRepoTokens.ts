import { apiFetch, isOffline } from "@/lib/apiBase";
import type { RepoDesignTokens } from "./designTokensToVariables";

export type RepoTokensResult =
  | { ok: true; repo: string; tokens: RepoDesignTokens; briefNotes: string[] }
  | { ok: false; error: string };

// A dialog should not hang: shorter than the agent tool's 25 s budget.
const TIMEOUT_MS = 15_000;

function backendMessage(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    return typeof parsed.error === "string" && parsed.error ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}

/** Reads a repo's design brief (POST /api/repo/brief) and returns only what the import needs. */
export async function fetchRepoTokens(repo: string): Promise<RepoTokensResult> {
  const name = repo.trim();
  if (!name) return { ok: false, error: 'Enter a repository, for example "shadcn-ui/ui".' };
  if (isOffline()) return { ok: false, error: "You are offline. Connect to the internet and try again." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  let text: string;
  try {
    res = await apiFetch("/api/repo/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: name }),
      signal: controller.signal,
    });
    text = await res.text();
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "Reading the repository took too long. Try again." : "Could not reach the server. Check your connection and try again.",
    };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const fallback =
      res.status === 404
        ? "Repository not found, or this server cannot read repositories."
        : `The server could not read the repository (error ${res.status}). Try again later.`;
    return { ok: false, error: backendMessage(text) ?? fallback };
  }
  let body: { tokens?: unknown; notes?: unknown; repo?: { owner?: string; name?: string } };
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: "The server is not set up to read repositories." };
  }
  if (!body.tokens || typeof body.tokens !== "object") {
    return { ok: false, error: "This repository has no design tokens that can be read." };
  }
  const label = body.repo?.owner && body.repo?.name ? `${body.repo.owner}/${body.repo.name}` : name;
  const briefNotes = Array.isArray(body.notes) ? body.notes.filter((n): n is string => typeof n === "string") : [];
  return { ok: true, repo: label, tokens: body.tokens as RepoDesignTokens, briefNotes };
}
