import type { ToolHandler } from "../../toolRegistry";
import {
  BROWSER_NOT_AVAILABLE_ERROR,
  fetchBrowseBackend,
  filterElementsForBackend,
  resultError,
  takeSnapshot,
  type PenDesktopBrowser,
  type SnapshotResult,
} from "./shared";

/**
 * browse_task — a Jev-driven browsing loop
 * (docs/superpowers/specs/2026-09-18-browse-task-jev-loop-design.md §3, as
 * corrected by the "Addendum, 2026-09-18: contract corrections after
 * review" at the end of that doc). Unlike browse_open/browse_act/
 * browse_find_images, this handler does not just forward one call to the
 * desktop bridge: it *is* the loop. Per cycle it takes a fresh
 * element-table snapshot from the page (`window.penDesktop.browser.snapshot()`),
 * POSTs it plus a short history to the backend's `/api/browse/step`
 * (stateless — Jev picks the next operation/target), and applies the
 * decision with `window.penDesktop.browser.perform(...)`. It repeats until
 * the backend answers `outcome: "done"` or `"blocked"`, or the budget
 * (`maxSteps`/deadline) runs out.
 *
 * One chat tool call therefore drives a whole multi-step task without the
 * design model in the loop at all — see the design doc's "Where the loop
 * runs" section for why this lives here rather than on the backend.
 */

/** design doc §3: "maxSteps default 12, hard cap 25". */
const DEFAULT_MAX_STEPS = 12;
const HARD_MAX_STEPS = 25;

/** design doc §3: BROWSE_TASK_DEADLINE_MS = 90_000. */
const BROWSE_TASK_DEADLINE_MS = 90_000;

/**
 * browse-speed-contract.md, "Frontend" item 4: how much of the deadline
 * must remain before STARTING a new step (snapshot → step → perform). A
 * step that begins with too little left can still burn most of a step's
 * own worst case before this loop's own deadline check would have caught
 * it on the NEXT iteration — reserving a margin means the loop bails before
 * starting a step it likely can't finish, rather than after.
 *
 * Finding: 15s was far short of one step's real worst case. A single step
 * is takeSnapshot (up to the desktop's 20s command budget) + requestStep
 * (up to shared.ts's BROWSE_BACKEND_REQUEST_TIMEOUT_MS = 20s) + the
 * act/perform call itself (up to 20s plus ~1.5s cursor-move budget) —
 * ~61.5s worst case, not the 15s this reserve assumed. 35s is the
 * documented middle-ground fix: it does not fully close the gap (a step
 * starting at deadline-35s could still finish around deadline+26.5s), but
 * it cuts the overrun from ~46.5s to ~26.5s, and — combined with raising
 * browse_task's client-side tool-call timeout from 100s to 150s
 * (useDesignChat.ts) — the worst-case total (BROWSE_TASK_DEADLINE_MS - this
 * reserve + one step's worst case = 90 - 35 + 61.5 = 116.5s) now lands
 * comfortably inside that 150s budget with margin to spare, so
 * BROWSE_TASK_DEADLINE_MS itself does not need to move.
 */
const STEP_DEADLINE_RESERVE_MS = 35_000;

/** design doc §3: "keeping a short history" / backend request shape: last 10 steps. */
const HISTORY_LIMIT = 10;

/**
 * Upstream jev-ultrafast PR #40 ("record stale executions so undecidable
 * stale loops can stop"), ported: how many consecutive steps may land
 * nothing before the loop gives up. A target that is persistently stale
 * between the snapshot and the act (a live-updating popover, a list that
 * re-renders on a timer) otherwise loops snapshot → step → rejected act
 * until maxSteps runs out, spending a paid Jev call per cycle without a
 * single executed action. Any step that lands — including a WAIT, which is
 * a deliberate decision, not a failure — resets the count.
 */
const MAX_CONSECUTIVE_UNPRODUCTIVE_STEPS = 3;

/**
 * Addendum A: "the loop sleeps ~400 ms itself, takes a fresh snapshot and
 * continues" when the decision is WAIT.
 */
const WAIT_SLEEP_MS = 400;

/**
 * Live bench finding (2026-09-24, fixture-shop run): Jev chose WAIT six
 * times in a row at low confidence (0.37-0.57) before anything else
 * happened. WAIT never reaches `perform`/`act` (addendum A), so it carries
 * no `changed`/`pageChanged` signal of its own and always used to be
 * recorded `ok: true` — the one signal that resets the
 * MAX_CONSECUTIVE_UNPRODUCTIVE_STEPS counter — so an unbroken run of WAITs
 * could never trip the stall detector no matter how long it went on.
 * Consecutive WAIT decisions landing on the SAME url (nothing navigated
 * between them, the only "did anything change" signal a targetless WAIT
 * has) are capped at this many BEFORE a WAIT stops actually sleeping: the
 * (N+1)th such WAIT is recorded as an unproductive step instead of being
 * executed, so the general unproductive-step counter (`note`, above) starts
 * advancing toward `stalled` rather than resetting on every idle WAIT.
 */
const MAX_CONSECUTIVE_SAME_URL_WAITS = 2;

/**
 * pen-editor-backend/src/routes/browseStep.ts's `historyEntrySchema` caps
 * `label` at 200 chars (`label: z.string().max(200)`) — every step this
 * loop records is appended to `history` and sent right back up on the
 * NEXT /api/browse/step call, so a label over that limit 400s that next
 * request and silently stalls the whole task (the loop's own error
 * handling treats a non-ok response as a thrown error, so this looked like
 * "the backend broke" rather than "our own label was too long"). The two
 * repos don't share code, so this is a plain mirrored constant, not an
 * import — keep it in sync with the backend schema if that cap ever moves.
 */
const HISTORY_LABEL_MAX_CHARS = 200;

/**
 * Per-fragment cap for a side-effect description folded into a step label
 * (an opened tab's title, an auto-handled dialog's message — both are
 * page-derived text with no length guarantee of their own). Generous
 * enough to stay informative while leaving room for the base label plus
 * whichever OTHER side-effect fragment rides along, so two long fragments
 * together still can't blow past HISTORY_LABEL_MAX_CHARS on their own —
 * recordStep's hard truncation is the final backstop regardless.
 */
const SIDE_EFFECT_FRAGMENT_MAX_CHARS = 60;

/** Truncates `value` to at most `max` characters, replacing anything cut
 * with a single ellipsis character so the cap is still exactly `max`. */
function truncateToChars(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** The operations `perform` actually accepts (addendum A: WAIT never reaches it). */
type PerformOperation = "CLICK" | "TYPE_TEXT" | "SELECT" | "SCROLL_UP" | "SCROLL_DOWN";

/**
 * The operations dispatched through `browser.act` instead of `browser.perform`
 * (docs/superpowers/specs/2026-09-23-full-browser-use-design.md, "act gains
 * actions and index targeting"). PRESS_ENTER/PRESS_ESCAPE act on whatever
 * currently has focus — right after TYPE_TEXT that's the field just typed
 * into — and carry no index; HOVER targets an element by index like CLICK
 * does.
 */
type ActOperation = "PRESS_ENTER" | "PRESS_ESCAPE" | "HOVER";

/** Everything a step response's `operation` may name. */
type StepOperation = PerformOperation | ActOperation | "WAIT";

/** Addendum B: the step response's explicit terminal/transient signal. */
type StepOutcome = "act" | "done" | "blocked" | "retry";

/** How a step's operation was decided — omitted for an ordinary confident
 * Jev decision (the common case), so existing transcripts/history entries
 * stay exactly as small as before. "cascade": the backend's
 * STRUCTURED_MODEL second opinion decided it after Jev's own peak
 * probability gate failed (see pen-editor-backend's cascadeStep). "rule": a
 * deterministic client-side guard overrode the decision entirely — e.g.
 * refusing to retype into the same search box twice in a row and pressing
 * Enter instead (see the TYPE_TEXT-dedup rule below `note`). */
type StepVia = "cascade" | "rule";

interface StepHistoryEntry {
  operation: string;
  label: string;
  ok: boolean;
  via?: StepVia;
}

interface StepResponse {
  /**
   * Addendum B. Optional in the type only because we must treat a
   * missing/unrecognized value defensively at runtime, the same as an
   * explicit "retry" — never as success.
   */
  outcome?: StepOutcome;
  /** Present for `outcome: "act"`; absent for done/blocked/retry. */
  operation?: StepOperation;
  index?: number;
  text?: string;
  confidence: number;
  model: string;
  reason?: string;
  /** Set by the backend cascade (see pen-editor-backend's browseStep.ts
   * `cascadeStep`) when a low-confidence Jev head was overridden by a
   * STRUCTURED_MODEL second opinion — surfaced to the transcript as
   * `via: "cascade"`. */
  cascade?: boolean;
}

interface TranscriptStep extends StepHistoryEntry {
  index?: number;
}

interface Transcript {
  status: "done" | "blocked" | "budget" | "stalled";
  steps: TranscriptStep[];
  url: string;
  title: string;
  reason?: string;
  /** Set when `openBeforeLoop`'s open() call reported `botCheck: true` —
   * surfaced so the caller/model knows this `blocked` is a CAPTCHA/bot-check
   * wall specifically, not an ordinary open failure or a Jev refusal. */
  botCheck?: true;
}

function labelForElement(elements: unknown[], index: number | undefined): string {
  if (index == null) return "";
  const el = elements[index] as { label?: unknown } | undefined;
  return el && typeof el.label === "string" ? el.label : "";
}

/** Requirement 2's "search-like field" test — a native search input, a
 * combobox/searchbox role, or a label/placeholder that reads like a search
 * box (the desktop snapshot already folds placeholder text into `label`).
 * Deliberately permissive: false positives just mean an ordinary text field
 * gets Enter pressed after a repeat TYPE_TEXT, which is a harmless no-op at
 * worst, not a destructive one. */
const SEARCH_LABEL_PATTERN = /search|find|query|поиск/i;

/** Mirrors the backend's hard credentials rule (browseStep.ts's
 * `operation === "PRESS_ENTER" && elements.some((el) => el.isPassword)`
 * gate): the client cannot know which element currently has focus, only
 * that a password field exists SOMEWHERE on the page — same reasoning the
 * PRESS_ENTER-after-TYPE_TEXT guard above already applies. Used to refuse
 * the TYPE_TEXT-dedup rule below on any page carrying a password field, so
 * this client-side override can never produce the PRESS_ENTER the backend
 * itself would have refused. */
function hasPasswordElement(elements: unknown[]): boolean {
  return elements.some((el) => (el as { isPassword?: unknown } | undefined)?.isPassword === true);
}

function isSearchLikeElement(elements: unknown[], index: number): boolean {
  const el = elements[index] as
    | { role?: unknown; label?: unknown; type?: unknown }
    | undefined;
  if (!el) return false;
  const role = typeof el.role === "string" ? el.role.toLowerCase() : "";
  const type = typeof el.type === "string" ? el.type.toLowerCase() : "";
  const label = typeof el.label === "string" ? el.label : "";
  return (
    type === "search" ||
    role === "searchbox" ||
    role === "combobox" ||
    SEARCH_LABEL_PATTERN.test(label)
  );
}

/**
 * Bench finding A (fixture-shop live run, all 3 runs): the very first
 * browse_task call was made before any tab was open, and burned three
 * whole Jev steps re-discovering "No browser tab is open — call
 * browse_open first" before finally giving up (MAX_CONSECUTIVE_UNPRODUCTIVE_STEPS).
 * Matches the bridge's own `browser.snapshot()` refusal message
 * (pen-editor-desktop's BrowserController) — kept as a substring match
 * rather than an exact string so a wording tweak on the desktop side
 * doesn't silently stop this from firing.
 */
const NO_TAB_OPEN_PATTERN = /no browser tab is open/i;

/** First http(s) URL literally present in the goal text, if any — used
 * when the model didn't pass `url` explicitly but phrased the goal as
 * "open https://... and do X". Deliberately simple (no goal parsing beyond
 * a URL regex): this is a convenience fallback, not the primary path — the
 * tool description asks the model to pass `url` directly. */
export function extractUrlFromGoal(goal: string): string | undefined {
  // `)` is deliberately NOT excluded here (unlike `"`/`'`/`<`/`>`, which
  // never legitimately appear in a bare URL) — a matched `)` can be part of
  // the URL itself (a Wikipedia-style path segment) or trailing punctuation
  // from the surrounding prose ("see https://x.com/a)."); the balance check
  // below tells the two apart instead of the character class blanket-
  // excluding it (finding: that used to cut off a genuinely balanced
  // trailing paren along with an unbalanced one).
  const match = goal.match(/https?:\/\/[^\s"'<>]+/i);
  if (!match) return undefined;
  // Finding: a URL embedded in prose commonly picks up trailing punctuation
  // that isn't part of the URL itself ("...go to https://x.com/a, then
  // search" or "see https://x.com/a]." from bracketed/quoted phrasing) — a
  // literal trailing char is stripped repeatedly, and a closing `)`/`]`/`}`
  // is only kept when it actually balances an opening one earlier in the
  // match (a URL can legitimately end with a balanced paren, e.g. a
  // Wikipedia-style link).
  let url = match[0];
  const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  while (url.length > 0) {
    const last = url[url.length - 1]!;
    if (",.;!".includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === "'" || last === '"') {
      url = url.slice(0, -1);
      continue;
    }
    const opener = CLOSERS[last];
    if (opener) {
      const opens = url.split(opener).length - 1;
      const closes = url.split(last).length - 1;
      if (closes > opens) {
        url = url.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return url.length > 0 ? url : undefined;
}

/** True when `a` and `b` are both parseable URLs sharing the same origin
 * (scheme + host + port). Used by finding #5's cross-origin navigation
 * check — defensively returns `true` (i.e. "don't navigate") when either
 * fails to parse, since staying on the current page is the safer default
 * over an unplanned open() call driven by a malformed URL. */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return true;
  }
}

/**
 * Opens `targetUrl` via the desktop bridge before the loop starts, folding
 * any failure into the same `{ status: "blocked", reason }` shape a step
 * failure would use. Returns `null` on success (caller proceeds into the
 * loop as normal).
 */
async function openBeforeLoop(
  browser: PenDesktopBrowser,
  targetUrl: string
): Promise<Transcript | null> {
  try {
    const opened = await browser.open({ url: targetUrl });
    const err = resultError(opened);
    if (err) {
      return { status: "blocked", steps: [], url: "", title: "", reason: `failed to open ${targetUrl}: ${err}` };
    }
    // Finding: a successful open() can still land on a bot-check/CAPTCHA
    // wall (pen-editor-desktop's BrowserController.checkBotWall merges
    // `{ botCheck: true }` into an otherwise-successful open result). That
    // is not something Jev can click through, so treat it as an immediate
    // `blocked` and hand over to the user rather than burning steps against
    // a wall the step loop has no way to pass.
    if (opened && typeof opened === "object" && (opened as { botCheck?: unknown }).botCheck === true) {
      return {
        status: "blocked",
        steps: [],
        url: "",
        title: "",
        reason: "bot check / CAPTCHA wall — hand over to the user",
        botCheck: true,
      };
    }
    return null;
  } catch (err) {
    return {
      status: "blocked",
      steps: [],
      url: "",
      title: "",
      reason: `failed to open ${targetUrl}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function requestStep(
  goal: string,
  snapshot: SnapshotResult,
  history: StepHistoryEntry[]
): Promise<StepResponse> {
  const res = await fetchBrowseBackend("/api/browse/step", {
    goal,
    url: snapshot.url,
    title: snapshot.title,
    // Scroll-container entries (`ops: []`, `scrollable: true`) fail the
    // backend's non-empty-`ops` schema on a lagging deployment — see
    // filterElementsForBackend's comment.
    elements: filterElementsForBackend(snapshot.elements),
    history: history.slice(-HISTORY_LIMIT),
    // browse-speed-contract.md, "Frontend" item 4 / "Backend" item 5: the
    // snapshot's scroll position, forwarded untouched so Jev's state digest
    // can mention it. Omitted entirely (rather than sent as `undefined`,
    // which JSON.stringify would drop from the body anyway) when the
    // snapshot doesn't carry one — an older desktop bridge, say.
    ...(snapshot.scroll !== undefined ? { scroll: snapshot.scroll } : {}),
  });
  if (!res.ok) {
    throw new Error(`/api/browse/step responded ${res.status}`);
  }
  return res.body as StepResponse;
}

/**
 * `openedTab`/`dialogs` (docs/superpowers/specs/
 * 2026-09-23-full-browser-use-design.md, "Desktop bridge") can ride along on
 * any `act`/`perform` result. Folded into the step's label (and therefore
 * into both the transcript and the history Jev sees on the next request) so
 * a tab switch or an auto-handled JS dialog isn't silently invisible to the
 * next decision — Jev needs to know the page it's driving just changed out
 * from under it.
 */
function describeSideEffects(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const parts: string[] = [];

  const openedTab = (value as { openedTab?: unknown }).openedTab;
  if (openedTab && typeof openedTab === "object") {
    const title = (openedTab as { title?: unknown }).title;
    const url = (openedTab as { url?: unknown }).url;
    const name =
      typeof title === "string" && title ? title : typeof url === "string" ? url : "new tab";
    parts.push(`→ opened tab: ${truncateToChars(name, SIDE_EFFECT_FRAGMENT_MAX_CHARS)}`);
  }

  const dialogs = (value as { dialogs?: unknown }).dialogs;
  if (Array.isArray(dialogs) && dialogs.length > 0) {
    const summary = dialogs
      .map((d: unknown) => {
        const type = d && typeof d === "object" && typeof (d as { type?: unknown }).type === "string"
          ? (d as { type: string }).type
          : "dialog";
        const message =
          d && typeof d === "object" && typeof (d as { message?: unknown }).message === "string"
            ? truncateToChars((d as { message: string }).message, SIDE_EFFECT_FRAGMENT_MAX_CHARS)
            : "";
        return message ? `${type}: ${message}` : type;
      })
      .join("; ");
    parts.push(`(dialog auto-handled: ${summary})`);
  }

  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/** True when a `browser.act` result explicitly reports `changed: false` —
 * the action ran (no `{ error }`) but altered nothing. See its call site's
 * comment for why that must count as an unproductive step for stall
 * detection, same as a rejected act. A result with no `changed` field at
 * all (a bridge that predates the `{ changed, changes }` diff, or a result
 * shape that doesn't carry it) is NOT treated as no-effect — only an
 * explicit `false` is, so this stays a strict tightening rather than a
 * behavior change for bridges that don't report it. */
function isNoEffectResult(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as { changed?: unknown }).changed === false;
}

/** Browse-speed contract (2026-09-24), frontend item 2: a `changed: false`
 * result (see isNoEffectResult above) is NOT actually unproductive when it
 * also reports `pageChanged: true` — the acted-on element's own signature
 * didn't move, but something a user would see elsewhere on the page did
 * (the canonical case: "Add to Cart" POSTs, then updates a separate
 * `#cart-status` element's text — the button itself never changes). Without
 * this, browse_task's loop recorded "(no effect)" and re-clicked the same
 * control repeatedly until it stalled, even though the click worked. Only
 * an explicit `pageChanged: true` counts — a missing field (a bridge that
 * predates it) stays "(no effect)", same conservative default
 * isNoEffectResult already uses for `changed`. Returns the label suffix to
 * record in place of "(no effect)", or `null` when the result doesn't
 * qualify. */
function describePageUpdate(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { pageChanged?: unknown; appeared?: unknown };
  if (v.pageChanged !== true) return null;
  const appeared = Array.isArray(v.appeared) ? v.appeared.filter((s): s is string => typeof s === "string") : [];
  const first = appeared[0];
  return first ? `(page updated: "${truncateToChars(first, SIDE_EFFECT_FRAGMENT_MAX_CHARS)}")` : "(page updated)";
}

/**
 * Records a step and appends it to the running history in one go —
 * hard-truncating `label` to HISTORY_LABEL_MAX_CHARS first. This is the
 * backstop, not describeSideEffects' per-fragment truncation above: the
 * BASE label (an element's own text, or an error message from the bridge/
 * backend) has no length guarantee either, so the cap has to apply here,
 * after everything is concatenated, not just to the side-effect fragments.
 */
function recordStep(
  steps: TranscriptStep[],
  history: StepHistoryEntry[],
  entry: TranscriptStep
): void {
  const truncated: TranscriptStep = {
    ...entry,
    label: truncateToChars(entry.label, HISTORY_LABEL_MAX_CHARS),
  };
  steps.push(truncated);
  history.push({ operation: truncated.operation, label: truncated.label, ok: truncated.ok });
}

/**
 * Runs the snapshot → step → perform loop. Exported separately from the
 * `ToolHandler` wrapper so tests can drive it directly and so the deadline
 * check and the WAIT sleep each have a single injectable seam — real time
 * (`Date.now`) and a real `setTimeout` in production, a fake clock and an
 * instrumented no-op sleep in tests exercising those branches without a
 * real wait.
 */
export async function runBrowseTaskLoop(
  goal: string,
  maxSteps: number,
  browser: NonNullable<NonNullable<typeof window.penDesktop>["browser"]>,
  now: () => number = () => Date.now(),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  url?: string
): Promise<Transcript> {
  const cappedMaxSteps = Math.min(Math.max(1, Math.floor(maxSteps)), HARD_MAX_STEPS);
  const deadline = now() + BROWSE_TASK_DEADLINE_MS;
  const steps: TranscriptStep[] = [];
  const history: StepHistoryEntry[] = [];

  let lastUrl = "";
  let lastTitle = "";

  // Bench finding A: don't spend paid Jev steps discovering there is no
  // browser tab open. Either an explicit `url` (open it first, always) or,
  // absent that, a cheap local snapshot probe: if the bridge reports no
  // tab, look for an http(s) URL inside the goal and open THAT; only if
  // neither is available do we give up immediately, before the loop
  // (and before any /api/browse/step call) even starts.
  //
  // Finding: a snapshot taken here that turns out to still be current (the
  // happy path below, where a tab is already open on the right origin) used
  // to be thrown away, only for the loop's own first iteration to take an
  // identical fresh one immediately after — doubling the snapshot cost of
  // every browse_task call that starts with a tab already open. Captured
  // here and handed to the loop as `initialSnapshot` instead.
  let initialSnapshot: SnapshotResult | undefined;
  if (url) {
    const openFailure = await openBeforeLoop(browser, url);
    if (openFailure) return openFailure;
  } else {
    const probe = await takeSnapshot(browser);
    if ("error" in probe) {
      if (NO_TAB_OPEN_PATTERN.test(probe.error)) {
        const goalUrl = extractUrlFromGoal(goal);
        if (!goalUrl) {
          return {
            status: "blocked",
            steps: [],
            url: "",
            title: "",
            reason: "No browser tab is open — pass url or call browse_open first",
          };
        }
        const openFailure = await openBeforeLoop(browser, goalUrl);
        if (openFailure) return openFailure;
      }
      // Any other probe error (unrelated to "no tab") is deliberately
      // discarded here — the loop's own first iteration takes its own
      // fresh snapshot below, keeping this probe a pure pre-check with no
      // effect on the loop's normal state machine.
    } else {
      // Finding: a tab is already open, but the goal may name a URL on a
      // DIFFERENT origin — that used to be silently ignored whenever any
      // tab happened to be open, even on an unrelated site. Only navigate
      // when the goal's URL and the current tab disagree on origin; same
      // origin (or no URL in the goal at all) means stay put and reuse this
      // snapshot as the loop's first iteration (see `initialSnapshot`
      // above).
      const goalUrl = extractUrlFromGoal(goal);
      if (goalUrl && !sameOrigin(goalUrl, probe.url)) {
        const openFailure = await openBeforeLoop(browser, goalUrl);
        if (openFailure) return openFailure;
        // The page just navigated — `probe` is now stale, do NOT reuse it.
      } else {
        initialSnapshot = probe;
      }
    }
  }

  // PR #40: a step that landed nothing is still recorded (Jev needs to see
  // the no-op in `history`, or it re-picks the same dead target), but three
  // in a row end the task instead of grinding out the whole budget.
  let unproductive = 0;
  /** The most recent SUCCESSFULLY landed step's `operation` — used to gate
   * PRESS_ENTER (see its dispatch below: Enter is only pressed right after
   * a TYPE_TEXT that landed, since a perform CLICK never moves focus, and a
   * WAIT/SCROLL in between means Enter would submit whatever the page
   * happens to have focus on, not the field Jev meant). `null` until the
   * first step lands. */
  let lastLandedOperation: string | null = null;
  /** Bench finding B: Jev kept re-typing the same query into the search box
   * instead of pressing Enter to submit it. Tracks the index (and text) of
   * the element a landed TYPE_TEXT just filled, so the very next decision
   * can be checked for the degenerate "type into the same field again"
   * pattern — see the TYPE_TEXT-dedup rule below, right after `operation`
   * is read out of the next decision. Cleared implicitly: the rule only
   * fires when `lastLandedOperation === "TYPE_TEXT"` too, so a landed
   * CLICK/SCROLL/etc. in between makes this stale value irrelevant even
   * though it isn't reset. */
  let lastTypeText: { index: number; text: string } | null = null;
  /** How many consecutive WAIT decisions have landed on the SAME url as the
   * previous WAIT (see MAX_CONSECUTIVE_SAME_URL_WAITS) — reset to 0 the
   * moment the url changes or a non-WAIT operation is decided. `null` url
   * means no WAIT has happened yet in the current streak. */
  let sameUrlWaitStreak = 0;
  let waitStreakUrl: string | null = null;
  /** recordStep plus the no-progress check. Returns the transcript to
   * return when the loop has stalled, or null to carry on. */
  const note = (entry: TranscriptStep): Transcript | null => {
    recordStep(steps, history, entry);
    if (entry.ok) {
      unproductive = 0;
      lastLandedOperation = entry.operation;
      return null;
    }
    unproductive++;
    if (unproductive < MAX_CONSECUTIVE_UNPRODUCTIVE_STEPS) return null;
    return {
      status: "stalled",
      steps,
      url: lastUrl,
      title: lastTitle,
      reason: `no progress — ${MAX_CONSECUTIVE_UNPRODUCTIVE_STEPS} consecutive steps landed nothing (last: ${entry.operation}: ${entry.label})`,
    };
  };

  for (let stepCount = 0; stepCount < cappedMaxSteps; stepCount++) {
    // browse-speed-contract.md, "Frontend" item 4: bail before STARTING a
    // step once less than STEP_DEADLINE_RESERVE_MS remains, not only once
    // the deadline itself has passed — a step begun with too little budget
    // left can still burn most of a desktop command timeout before the
    // loop gets back here to notice.
    if (deadline - now() < STEP_DEADLINE_RESERVE_MS) {
      return { status: "budget", steps, url: lastUrl, title: lastTitle, reason: "deadline exceeded" };
    }

    // Finding: reuse the pre-loop probe as this first iteration's snapshot
    // (when one was captured — see `initialSnapshot`'s comment above)
    // instead of immediately re-taking an identical one.
    const snapshotResult =
      stepCount === 0 && initialSnapshot ? initialSnapshot : await takeSnapshot(browser);
    if ("error" in snapshotResult) {
      const stalled = note({
        operation: "SNAPSHOT",
        label: snapshotResult.error,
        ok: false,
      });
      if (stalled) return stalled;
      continue;
    }
    const snapshot: SnapshotResult = snapshotResult;

    lastUrl = snapshot.url;
    lastTitle = snapshot.title;

    let decision: StepResponse;
    try {
      decision = await requestStep(goal, snapshot, history);
    } catch (err) {
      const stalled = note({
        operation: "STEP",
        label: err instanceof Error ? err.message : "/api/browse/step failed",
        ok: false,
      });
      if (stalled) return stalled;
      continue;
    }

    // Addendum B: outcome is the explicit terminal/transient signal. `done`
    // and `blocked` end the task; `retry` (Jev timeout/malformed answer/no
    // candidate element) and anything unrecognized or missing are recorded
    // and the loop continues — treating an unknown outcome as a silent
    // success would be exactly the bug the addendum corrects.
    // Requirement 4: keep `reason` on terminal statuses, and say when the
    // STRUCTURED_MODEL cascade (not Jev itself) is what decided it — the
    // bench reads these.
    const terminalReason = decision.cascade
      ? `${decision.reason ?? ""}${decision.reason ? " " : ""}(via cascade)`
      : decision.reason;
    if (decision.outcome === "done") {
      return { status: "done", steps, url: lastUrl, title: lastTitle, reason: terminalReason };
    }
    if (decision.outcome === "blocked") {
      return { status: "blocked", steps, url: lastUrl, title: lastTitle, reason: terminalReason };
    }
    if (decision.outcome === "retry") {
      const stalled = note({
        operation: decision.operation ?? "RETRY",
        label: decision.reason ?? "transient step failure, retrying",
        ok: false,
      });
      if (stalled) return stalled;
      continue;
    }
    if (decision.outcome !== "act") {
      const stalled = note({
        operation: decision.operation ?? "UNKNOWN_OUTCOME",
        label: decision.reason ?? `unrecognized step outcome: ${String(decision.outcome)}`,
        ok: false,
      });
      if (stalled) return stalled;
      continue;
    }

    // outcome === "act" from here on.
    const cascadeVia: StepVia | undefined = decision.cascade ? "cascade" : undefined;

    if (decision.operation === "WAIT") {
      const sameUrlAsLastWait = waitStreakUrl !== null && snapshot.url === waitStreakUrl;
      sameUrlWaitStreak = sameUrlAsLastWait ? sameUrlWaitStreak + 1 : 1;
      waitStreakUrl = snapshot.url;

      if (sameUrlWaitStreak > MAX_CONSECUTIVE_SAME_URL_WAITS) {
        // A 3rd (or later) consecutive WAIT landing on the same url as the
        // last one is not executed — nothing changed the last two times we
        // slept, so sleeping again is treated as the unproductive step it
        // actually is (see MAX_CONSECUTIVE_SAME_URL_WAITS), letting the
        // general no-progress counter advance instead of resetting.
        const stalled = note({
          operation: "WAIT",
          label: "(waited, nothing changed)",
          ok: false,
          ...(cascadeVia ? { via: cascadeVia } : {}),
        });
        if (stalled) return stalled;
        continue;
      }

      // Addendum A: WAIT never reaches `perform` — the loop sleeps itself
      // and takes a fresh snapshot on the next iteration.
      note({
        operation: "WAIT",
        label: "waiting for the page to settle",
        ok: true,
        ...(cascadeVia ? { via: cascadeVia } : {}),
      });
      // browse-speed-contract.md, "Frontend" item 4: cap the sleep by
      // whatever's actually left of the deadline, so a WAIT decided with
      // little budget remaining can't itself blow past it.
      await sleep(Math.max(0, Math.min(WAIT_SLEEP_MS, deadline - now())));
      continue;
    }
    sameUrlWaitStreak = 0;
    waitStreakUrl = null;

    let operation = decision.operation;
    if (!operation) {
      const stalled = note({
        operation: "MALFORMED",
        label: decision.reason ?? "act outcome with no operation",
        ok: false,
      });
      if (stalled) return stalled;
      continue;
    }

    // Requirement 2 / bench finding B: Jev (or the cascade) kept re-typing
    // the same query into the search box instead of submitting it. If the
    // step JUST landed a TYPE_TEXT into a search-like field and the very
    // next decision is TYPE_TEXT into that SAME element again, override to
    // PRESS_ENTER instead of repeating the type — a deterministic rule, not
    // a threshold, so it applies regardless of which head/model chose the
    // repeat. Must run before the targetless/index checks below, since
    // PRESS_ENTER (unlike TYPE_TEXT) needs no index.
    let via: StepVia | undefined = cascadeVia;
    if (
      operation === "TYPE_TEXT" &&
      lastLandedOperation === "TYPE_TEXT" &&
      decision.index != null &&
      lastTypeText !== null &&
      lastTypeText.index === decision.index &&
      isSearchLikeElement(snapshot.elements, decision.index) &&
      !hasPasswordElement(snapshot.elements)
    ) {
      operation = "PRESS_ENTER";
      via = "rule";
    }

    // Full browser use (docs/superpowers/specs/
    // 2026-09-23-full-browser-use-design.md): PRESS_ENTER/PRESS_ESCAPE are
    // targetless (they act on whatever already has focus — right after
    // TYPE_TEXT that's the field just typed into), same as a scroll. HOVER
    // targets an element by index, same as CLICK.
    const isTargetless =
      operation === "SCROLL_UP" ||
      operation === "SCROLL_DOWN" ||
      operation === "PRESS_ENTER" ||
      operation === "PRESS_ESCAPE";
    const label = labelForElement(snapshot.elements, decision.index);

    // Addendum A / item 3: CLICK/TYPE_TEXT/SELECT/HOVER require an index; a
    // scroll or a targetless press legitimately carries none. A non-scroll,
    // non-targetless decision arriving without an index is recorded as a
    // failed step rather than forwarded to `perform`/`act`.
    if (!isTargetless && decision.index == null) {
      const stalled = note({
        operation,
        label: label || "missing index for a non-scroll operation",
        ok: false,
      });
      if (stalled) return stalled;
      continue;
    }

    if (operation === "PRESS_ENTER" || operation === "PRESS_ESCAPE" || operation === "HOVER") {
      // Full browser use follow-up (finding: Enter is only meaningful right
      // after typing into a field). The backend already refuses PRESS_ENTER
      // when a password field is anywhere on the page, but it has no way to
      // know WHICH element currently has focus — that's client-side state.
      // A perform CLICK never moves focus, so the only step that reliably
      // leaves the right field focused is a just-landed TYPE_TEXT; anything
      // else (including a WAIT/SCROLL taken in between) means Enter would
      // submit whatever the page happens to have focus on, not the field
      // Jev meant. Refused without ever calling the bridge — recorded as a
      // failed (not stale-target) step so Jev sees why and picks something
      // else next cycle.
      if (operation === "PRESS_ENTER" && lastLandedOperation !== "TYPE_TEXT") {
        const stalled = note({
          operation,
          label: "Enter is only pressed right after typing into a field",
          ok: false,
          index: decision.index,
        });
        if (stalled) return stalled;
        continue;
      }

      const actArgs: Record<string, unknown> =
        operation === "HOVER"
          ? { action: "hover", index: decision.index, snapshotId: snapshot.snapshotId }
          : { action: "press", key: operation === "PRESS_ENTER" ? "Enter" : "Escape" };
      const actLabel =
        operation === "HOVER"
          ? label
          : operation === "PRESS_ENTER"
            ? via === "rule"
              ? "press Enter (avoided retyping into the same field)"
              : "press Enter"
            : "press Escape";

      try {
        const acted = await browser.act(actArgs);
        // Same PR #40 contract as `perform`: the bridge resolves `{ error }`
        // rather than rejecting.
        const rejected = resultError(acted);
        // Finding: a `changed: false` result (see the desktop bridge's
        // `{ changed, changes }` diff) landed with no error but altered
        // nothing — e.g. Escape with nothing open to close, or hovering an
        // element that has no hover-revealed state. That is exactly the
        // "no progress" case the consecutive-unproductive-steps counter
        // exists to catch, so it must count the same way a rejected act
        // does, not as a landed action.
        const noEffectRaw = !rejected && isNoEffectResult(acted);
        const pageUpdate = noEffectRaw ? describePageUpdate(acted) : null;
        const noEffect = noEffectRaw && !pageUpdate;
        const stalled = note(
          rejected
            ? { operation, label: rejected, ok: false, index: decision.index }
            : {
                operation,
                label: `${actLabel}${describeSideEffects(acted)}${pageUpdate ? ` ${pageUpdate}` : ""}`,
                ok: !noEffect,
                index: decision.index,
                ...(via ? { via } : {}),
              }
        );
        if (stalled) return stalled;
      } catch (err) {
        const stalled = note({
          operation,
          label: err instanceof Error ? err.message : "act failed",
          ok: false,
          index: decision.index,
        });
        if (stalled) return stalled;
      }
      continue;
    }

    const performArgs: {
      snapshotId: string;
      index?: number;
      operation: PerformOperation;
      text?: string;
    } = {
      snapshotId: snapshot.snapshotId,
      operation,
      text: decision.text,
    };
    // Only forward `index` when it is genuinely present — never
    // `index: undefined` for a scroll, per addendum A.
    if (decision.index != null) {
      performArgs.index = decision.index;
    }

    try {
      const performed = await browser.perform(performArgs);
      // PR #40: `perform` resolves with `{ error }` rather than rejecting
      // (see resultError) — a stale snapshotId, a target that is gone or
      // occluded. Recording that as a landed action is what let a
      // persistently stale target loop forever while the transcript
      // claimed success on every cycle.
      const rejected = resultError(performed);
      // browse-speed-contract.md, "Frontend" item 4: a CLICK/TYPE_TEXT/
      // SELECT that resolved with no error but `changed: false` still
      // landed nothing — same "no progress" case the act path already
      // counts via isNoEffectResult (see that function's comment), now
      // applied to perform too.
      const noEffectRaw = !rejected && isNoEffectResult(performed);
      // browse-speed-contract.md, "Frontend" item 2: `changed: false` +
      // `pageChanged: true` (see describePageUpdate's doc comment) is not
      // the "no progress" case — something the user would see did happen,
      // just not on the acted-on element itself.
      const pageUpdate = noEffectRaw ? describePageUpdate(performed) : null;
      const noEffect = noEffectRaw && !pageUpdate;
      // Requirement 2 (typed-state awareness): a plain element label
      // ("Search") tells the NEXT decision nothing about what was already
      // typed there — the history sent back to /api/browse/step must say
      // what was typed where, or Jev has no signal that the field is
      // already filled with its own prior guess.
      const displayLabel =
        operation === "TYPE_TEXT" && decision.text
          ? `TYPE_TEXT "${truncateToChars(decision.text, 60)}" into "${label}"`
          : label;
      const stalled = note(
        rejected
          ? { operation, label: rejected, ok: false, index: decision.index }
          : {
              operation,
              label: noEffect
                ? `${displayLabel}${describeSideEffects(performed)} (no effect)`
                : `${displayLabel}${describeSideEffects(performed)}${pageUpdate ? ` ${pageUpdate}` : ""}`,
              ok: !noEffect,
              index: decision.index,
              ...(via ? { via } : {}),
            }
      );
      if (stalled) return stalled;
      // Track the just-landed TYPE_TEXT for the next iteration's dedup
      // rule above — only on a genuinely landed (not rejected, not
      // no-effect) TYPE_TEXT.
      if (operation === "TYPE_TEXT" && !rejected && !noEffect && decision.index != null) {
        lastTypeText = { index: decision.index, text: decision.text ?? "" };
      }
    } catch (err) {
      // A failing step (design doc §3/§4: "a failing step is recorded and
      // does not abort the whole task") is recorded in the transcript and
      // the loop continues — only a done/blocked outcome, the no-progress
      // check, maxSteps or the deadline end the task.
      const stalled = note({
        operation,
        label: err instanceof Error ? err.message : "perform failed",
        ok: false,
        index: decision.index,
      });
      if (stalled) return stalled;
    }
  }

  return { status: "budget", steps, url: lastUrl, title: lastTitle, reason: "maxSteps reached" };
}

export const browseTask: ToolHandler = async (args) => {
  const browser = window.penDesktop?.browser;
  if (!browser) {
    return JSON.stringify({ error: BROWSER_NOT_AVAILABLE_ERROR });
  }

  const goal = typeof args.goal === "string" ? args.goal : "";
  const maxSteps =
    typeof args.maxSteps === "number" && Number.isFinite(args.maxSteps)
      ? args.maxSteps
      : DEFAULT_MAX_STEPS;
  const url = typeof args.url === "string" && args.url.length > 0 ? args.url : undefined;

  try {
    const transcript = await runBrowseTaskLoop(goal, maxSteps, browser, undefined, undefined, url);
    // Matches every other browser tool handler's "always resolves a real
    // JSON string" contract (see shared.ts's callBrowserBridge comment) —
    // this handler doesn't route through callBrowserBridge since it makes
    // many bridge/network calls rather than one, but the guarantee is the
    // same.
    return JSON.stringify(transcript ?? {});
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : "browse_task failed.",
    });
  }
};
