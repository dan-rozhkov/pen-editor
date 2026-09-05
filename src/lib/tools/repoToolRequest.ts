import { resolveApiUrl, isOffline } from "@/lib/apiBase";

// Shared transport for the two repo-reading tools (read_design_repo,
// read_repo_files). Both are client-executed — their backend schemas
// (pen-editor-backend/src/ai/tools.ts) declare no `execute`, so the handler
// here proxies to the backend REST route that does the GitHub work. The
// request/error handling is identical for both, so it lives in one place
// rather than being copied per handler.

// A GitHub read can be slow (rate limits, large repos); keep this under the
// tool-call loop's default 30s budget (useDesignChat.ts,
// DEFAULT_TOOL_CALL_TIMEOUT_MS) so a hung backend produces a readable
// tool-specific message instead of the generic "Tool call timed out".
const REQUEST_TIMEOUT_MS = 25_000;

/**
 * POST `body` to a backend repo route and return the tool result string.
 *
 * The response body is passed through verbatim: the backend owns the shape of
 * the design brief / file list, and re-describing it here would only create a
 * second definition to drift out of sync with it. Failures come back as a
 * `{ error }` JSON string — never a throw — so the model reads the reason
 * (rate limit, unknown repo, offline) and can act on it in the next step.
 */
export async function postRepoRequest(
  toolName: string,
  path: string,
  body: Record<string, unknown>,
): Promise<string> {
  if (isOffline()) {
    return JSON.stringify({
      error: `Offline: ${toolName} requires a network connection.`,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  let text: string;
  try {
    res = await fetch(resolveApiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    text = await res.text();
  } catch (err) {
    return JSON.stringify({ error: describeNetworkError(toolName, err) });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // A 404 is ambiguous in a way that matters: it is the backend saying the
    // repository does not exist, *or* the route not being deployed at all. The
    // model can act on the first and not the second, so name both.
    const hint =
      res.status === 404
        ? " (either the repository/ref does not exist, or this backend does not serve the repo routes)"
        : "";
    return JSON.stringify({
      error: `${toolName} failed (${res.status})${hint}: ${readErrorMessage(res, text)}`,
    });
  }

  // Parsed rather than passed through blind: a same-origin SPA rewrite answers
  // with 200 and an HTML shell when no backend is configured, and reporting
  // that as a network error would send the model looking in the wrong place.
  try {
    JSON.parse(text);
  } catch {
    return JSON.stringify({
      error: `${toolName} got a non-JSON response from the backend — the design-agent backend URL is probably not configured or not reachable.`,
    });
  }
  return text;
}

/**
 * When a local repo is attached, it wins over an explicit `repo` argument
 * deliberately (the user attached it on purpose) — but silently dropping
 * that argument on the floor is confusing, especially when it happens to
 * name a real, different repository. This folds `ignoredRepoArg` into a
 * successful JSON object response so the model can see its argument was
 * overridden rather than guessing why the local repo answered instead.
 *
 * A no-op when `ignoredRepoArg` is empty (no argument was actually sent), or
 * when `raw` isn't a plain JSON object (an error response, or anything the
 * backend shape ever turns out not to be) — passed through unchanged rather
 * than risking a malformed result.
 */
export function annotateIgnoredRepoArg(raw: string, ignoredRepoArg: string): string {
  if (!ignoredRepoArg) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      !("error" in parsed)
    ) {
      return JSON.stringify({ ...parsed, ignoredRepoArg });
    }
  } catch {
    // Not JSON — pass through unchanged.
  }
  return raw;
}

function readErrorMessage(res: Response, text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error) {
      return parsed.error;
    }
  } catch {
    // Body wasn't JSON (or was empty) — fall through to a generic message.
  }
  return res.statusText || "request failed";
}

function describeNetworkError(toolName: string, err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") {
    return `${toolName} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`;
  }
  return `${toolName} network error: ${err instanceof Error ? err.message : String(err)}`;
}
