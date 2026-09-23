/**
 * Jev taste checks on generated/edited embed screens.
 *
 * The backend's `/api/taste-check` (contract, built in parallel — see
 * docs/superpowers/specs for the eventual design doc) runs an automated
 * taste pass over one or more HTML embed screens and returns ready-to-append
 * English feedback for the model.
 *
 * This runs in the CHAT PATH, not inside a tool handler. `batch_design` and
 * `edit_embed_html` only record which embeds they touched (see
 * `tasteCheckRegistry.ts`) and return immediately — their result is
 * unaffected by any of this. `useDesignChat.ts`'s `onToolCall` calls
 * `runTasteCheckForToolCall` AFTER the tool handler (and the scene-mutation
 * queue it ran inside — see toolCallQueue.ts) has already resolved, so a
 * slow or failed check can never hold up other mutating calls or turn a
 * committed tool call into an error. `onToolCall` DOES await this call
 * (unlike an earlier version of this feature): `chat.status` stays
 * "streaming" for the ~8s (at most) the check can take, which is exactly
 * what keeps the queue-drain effect / Send / Rollback / Clear chat from
 * acting on a turn that still has an unresolved tool part. The caller passes
 * an `AbortSignal` that fires on Stop so a check in flight when the user
 * stops the turn returns promptly instead of running out its own timeout.
 *
 * Fail-open, unconditionally: any error, non-200, timeout, or caller abort
 * leaves the tool's own result untouched — a taste check must never block or
 * corrupt the tool result the model is waiting on.
 */

import { resolveApiUrl } from "@/lib/apiBase";
import { useSceneStore } from "@/store/sceneStore";
import type { EmbedNode, FlatSceneNode } from "@/types/scene";
import { takeTouchedEmbeds } from "./tasteCheckRegistry";

/** Backend caps a request at 8 screens; a batch touching more only checks the first 8. */
const MAX_SCREENS_PER_REQUEST = 8;

/** An embed stops being checked once it has this many *completed* (outcome "checked") rounds. */
const MAX_CHECKS_PER_EMBED = 2;

/** Keeps the check from ever meaningfully delaying the tool result. */
const TASTE_CHECK_TIMEOUT_MS = 8_000;

/** Matches the backend's own `brief` length cap. */
const MAX_BRIEF_CHARS = 4000;

/** Matches the backend's own zod `name` cap — an untruncated name over this
 * would 400 the WHOLE request, not just drop that one screen's name. */
const MAX_NAME_CHARS = 200;

/** Matches the backend's own request-body HTML cap (it rejects >200k with 400). */
const MAX_HTML_CHARS = 200_000;

/**
 * nodeId -> number of COMPLETED checks (outcome === "checked"). Module-level
 * because both call sites (batch_design, edit_embed_html) need to share the
 * same round counter for the same node across separate tool calls within a
 * session's lifetime — there is nowhere else in the client that already
 * tracks "how many times has this screen been taste-checked."
 */
const completedChecks = new Map<string, number>();

/**
 * Once the backend answers 503/404, or an `outcome` of `"off"`/`"no-client"`
 * (the check is disabled server-side, or no Jev client is configured at
 * all), further checks are pointless for the rest of this page session —
 * stop uploading HTML for nothing. Sticky for the page's lifetime; a fresh
 * page load (fresh module instance) gets a clean slate in case the backend
 * recovers.
 */
let disabledForSession = false;

/** Circuit breaker: trip after this many CONSECUTIVE timeouts or 5xx/network
 * failures — an ailing backend shouldn't keep costing every batch_design/
 * edit_embed_html call an ~8s wait for a check that's unlikely to succeed. */
const CONSECUTIVE_FAILURE_LIMIT = 2;

/** Consecutive timeout/5xx/network failures since the last successful
 * response (any response short of those three resets it — see
 * `recordCheckSuccess`). An abort caused by the CALLER's signal (Stop) is
 * deliberately not a failure here — see `runTasteCheckForEmbeds`. */
let consecutiveFailures = 0;

function recordCheckFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
    disabledForSession = true;
  }
}

function recordCheckSuccess(): void {
  consecutiveFailures = 0;
}

/** Test-only: clear round bookkeeping between cases. */
export function resetTasteCheckRounds(): void {
  completedChecks.clear();
}

/** Test-only: clear the kill switch between cases. */
export function resetTasteCheckKillSwitch(): void {
  disabledForSession = false;
}

/** Test-only: clear the consecutive-failure breaker between cases. */
export function resetTasteCheckBreaker(): void {
  consecutiveFailures = 0;
}

interface TasteCheckRequestScreen {
  id: string;
  name?: string;
  html: string;
}

interface TasteCheckFinding {
  rule: string;
  title: string;
  fix: string;
  noul?: unknown;
}

interface TasteCheckResponse {
  outcome: "checked" | "off" | "no-client" | "failed" | "nothing-to-check";
  screens?: { id: string; name?: string; findings: TasteCheckFinding[] }[];
  feedback: string | null;
}

export interface RunTasteCheckOptions {
  /** Latest user chat message text, when cheaply available to the caller. Truncated to 4000 chars. */
  brief?: string;
  /**
   * When true, an embed is only eligible if it already has at least one
   * COMPLETED check this session — used by `edit_embed_html` so editing a
   * user's own, never-generated embed never starts a check on it. Only a
   * screen the agent generated via `batch_design` (and that was actually
   * checked at least once) is eligible for a follow-up check via an edit.
   */
  requireExistingCheck?: boolean;
}

function isCheckableEmbed(
  node: FlatSceneNode | undefined,
): node is FlatSceneNode & EmbedNode {
  return (
    node !== undefined &&
    node.type === "embed" &&
    typeof (node as unknown as EmbedNode).htmlContent === "string" &&
    (node as unknown as EmbedNode).htmlContent.length > 0
  );
}

/** Replaces `data:` URIs (images, fonts, ...) with a short placeholder — they
 * can be megabytes and add nothing a taste check needs to see. */
function stripDataUris(html: string): string {
  return html.replace(/data:[^"')\s]+/g, "data:…");
}

function capHtml(html: string): string {
  return html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
}

/**
 * Combines an optional caller-supplied signal (fires on Stop) with our own
 * internal timeout signal, so the fetch below aborts on whichever comes
 * first. `AbortSignal.any` is the standard combinator (Node 20+ / all
 * evergreen browsers, and available in this project's TS lib target); the
 * manual fallback only matters for a runtime old enough to lack it.
 */
function combineSignals(a: AbortSignal, b: AbortSignal | undefined): AbortSignal {
  if (!b) return a;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  const onAbort = (source: AbortSignal) => controller.abort(source.reason);
  a.addEventListener("abort", () => onAbort(a), { once: true });
  b.addEventListener("abort", () => onAbort(b), { once: true });
  return controller.signal;
}

/**
 * Run a taste check for whichever of `nodeIds` are still eligible (embeds
 * with non-empty html and fewer than `MAX_CHECKS_PER_EMBED` completed
 * rounds), reading each node's current `htmlContent`/`name` from the live
 * scene store. Returns the backend's `feedback` string, or `null` on
 * anything short of a clean "checked" response — never throws.
 */
export async function runTasteCheckForEmbeds(
  nodeIds: string[],
  opts?: RunTasteCheckOptions,
  signal?: AbortSignal,
): Promise<string | null> {
  if (disabledForSession) return null;

  try {
    const nodesById = useSceneStore.getState().nodesById;
    const uniqueIds = [...new Set(nodeIds)];

    const eligible = uniqueIds.filter((id) => {
      if (!isCheckableEmbed(nodesById[id])) return false;
      const completed = completedChecks.get(id) ?? 0;
      if (opts?.requireExistingCheck && completed < 1) return false;
      return completed < MAX_CHECKS_PER_EMBED;
    });

    if (eligible.length === 0) return null;

    const capped = eligible.slice(0, MAX_SCREENS_PER_REQUEST);

    const screens: TasteCheckRequestScreen[] = capped.map((id) => {
      const node = nodesById[id] as unknown as EmbedNode & FlatSceneNode;
      return {
        id,
        ...(node.name ? { name: node.name.slice(0, MAX_NAME_CHARS) } : {}),
        html: capHtml(stripDataUris(node.htmlContent)),
      };
    });

    // A request mixing screens at different prior rounds sends the max —
    // the backend's `round` is a single number for the whole request.
    const round = Math.max(...capped.map((id) => (completedChecks.get(id) ?? 0) + 1));

    const body: Record<string, unknown> = { screens, round };
    if (opts?.brief) {
      body.brief = opts.brief.slice(0, MAX_BRIEF_CHARS);
    }

    let res: Response;
    try {
      res = await fetch(resolveApiUrl("/api/taste-check"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: combineSignals(AbortSignal.timeout(TASTE_CHECK_TIMEOUT_MS), signal),
      });
    } catch (err) {
      // A caller-initiated abort (Stop) is not a circuit-breaker failure —
      // the check was cut short on purpose, not because the backend is
      // ailing. Everything else here (our own timeout firing, or a genuine
      // network error) counts toward the breaker.
      if (signal?.aborted) return null;
      recordCheckFailure();
      throw err;
    }

    if (res.status === 503 || res.status === 404) {
      // Expected, not a failure: the feature is off server-side.
      recordCheckSuccess();
      disabledForSession = true;
      return null;
    }

    if (res.status >= 500) {
      recordCheckFailure();
      return null;
    }

    recordCheckSuccess();

    if (!res.ok) return null;

    const data = (await res.json()) as TasteCheckResponse;

    if (data.outcome === "off" || data.outcome === "no-client") {
      disabledForSession = true;
      return null;
    }

    if (data.outcome === "checked") {
      // Only the ids the backend actually returned in `screens` — it fails
      // open PER SCREEN (a screen it couldn't check is simply omitted, not
      // an error for the whole request), so crediting every id in `capped`
      // would count a screen as checked when the backend silently skipped
      // it, letting it exhaust MAX_CHECKS_PER_EMBED without ever having been
      // looked at.
      const respondedIds = new Set((data.screens ?? []).map((screen) => screen.id));
      for (const id of capped) {
        if (!respondedIds.has(id)) continue;
        completedChecks.set(id, (completedChecks.get(id) ?? 0) + 1);
      }
    }

    return data.feedback ?? null;
  } catch {
    // Network error, abort/timeout, malformed JSON — fail open.
    return null;
  }
}

/**
 * Merge taste-check feedback into a tool result string without changing its
 * shape for the model: a JSON object gets a `tasteCheck` field added and is
 * re-stringified (still valid JSON); anything else (or JSON that isn't a
 * plain object — an array, a bare string/number) gets the feedback appended
 * as plain text after a blank line, matching how the two tools already
 * appended feedback before this moved out of the handlers.
 */
export function mergeTasteFeedback(result: string, feedback: string): string {
  try {
    const parsed: unknown = JSON.parse(result);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return JSON.stringify({ ...(parsed as Record<string, unknown>), tasteCheck: feedback });
    }
  } catch {
    // Not JSON — fall through to plain-text append.
  }
  return `${result}\n\n${feedback}`;
}

/**
 * Orchestrates a taste check for one finished tool call: takes back whatever
 * embed ids that tool call recorded (`tasteCheckRegistry.ts`), runs the
 * check for the eligible ones, and merges any feedback into `result`. Only
 * `batch_design` and `edit_embed_html` ever record touched embeds, so this
 * is a no-op (returns `result` unchanged) for every other tool — safe to
 * call unconditionally from `onToolCall`.
 *
 * `batch_design`'s own eligibility rule (on top of `runTasteCheckForEmbeds`'s
 * own `MAX_CHECKS_PER_EMBED` cap): a touched embed only starts a check if
 * this call CREATED it (I()/R() only — `createdEmbedIds`) or it already has
 * at least one completed check from an earlier call. A bare U() replacing
 * htmlContent on an embed the agent never generated — i.e. the user's own
 * screen — is neither, so it's filtered out here before
 * `runTasteCheckForEmbeds` ever sees it: this is the ONE thing preventing an
 * unrelated edit to a hand-authored screen from silently starting a check on
 * it. A C() copy is deliberately treated the same as a U() here (never
 * `createdEmbedIds` — see `executeCopy`'s doc comment in executor.ts): a
 * copy of the user's own screen must not start a check either, and a copy of
 * an already-checked screen must not reset its round counter. `edit_embed_html`
 * never creates embeds (registry's `created` is always `[]` for it), so it
 * keeps relying on `runTasteCheckForEmbeds`'s own `requireExistingCheck` for
 * the equivalent "already checked once" rule.
 *
 * Called strictly AFTER the tool's own handler (and the scene-mutation
 * queue it ran inside) has resolved — see this module's doc comment. `signal`
 * fires when the caller's turn is aborted (Stop); it's threaded down to
 * `runTasteCheckForEmbeds`'s fetch and never turned into a thrown error here.
 */
export async function runTasteCheckForToolCall(
  toolName: string,
  toolCallId: string | undefined,
  result: string,
  opts?: { brief?: string },
  signal?: AbortSignal,
): Promise<string> {
  const { touched, created } = takeTouchedEmbeds(toolCallId);
  if (touched.length === 0) return result;

  let idsToCheck = touched;
  if (toolName === "batch_design") {
    const createdThisCall = new Set(created);
    idsToCheck = touched.filter(
      (id) => createdThisCall.has(id) || (completedChecks.get(id) ?? 0) >= 1,
    );
    if (idsToCheck.length === 0) return result;
  }

  const feedback = await runTasteCheckForEmbeds(
    idsToCheck,
    {
      brief: opts?.brief,
      requireExistingCheck: toolName === "edit_embed_html",
    },
    signal,
  );

  return feedback ? mergeTasteFeedback(result, feedback) : result;
}
