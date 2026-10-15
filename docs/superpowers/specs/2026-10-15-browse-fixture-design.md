# browse_agent `setup`: page fixtures in Pen Editor (2026-10-15)

The chat model can prepare the browser before a browse task: steps, an `expect`
check, API mocks, a fresh session, storage. It uses `PageFixture` from
`@sideform/browser-agent` v0.2.14 (`fixture` subpath). Decision: the model writes
the fixture (variant A). No saved states, no settings toggle.

## 1. Tool and data flow

**Schema (backend `src/ai/tools.ts`, `browse_agent`).** New optional `setup`:
`PageFixture` without `version` and without `url` (the tool's `url` is the start URL).
Fields: `tabs`, `storage` (`cookies`, `origins`), `steps`, `expect`, `network`, `fresh`.
Bounded: at most 20 steps, 20 network rules, 10 tabs, 20 cookies, 10 storage origins.
The description says when to use it: QA checks, a known state before the task,
simulated API errors. Every field works in both browsers; the `fresh` description
says that on desktop it clears only the sites the setup names.

**Frontend handler (`src/lib/tools/browser/browseAgent.ts`).** With `setup`, it builds
`fixture = { version: 1, ...setup, url }` and passes `session.run(goal, driver, { setup })`
(not `url`). The hook does what the package's private `prepareFixture` does
(`src/agent/aiSdk.ts`): parse, `bridge.applyFixture(fixture, { signal, allowNetworkMocks: true })`,
throw `SetupError(stage, error)` on failure, keep `fixtureToken`, take a `browse_snapshot`
through `executeToolCall`, return `fixtureSetupBody(summary, snapshot)`. In `finally` the
handler calls `bridge.releaseFixture(token)` (bounded to 10 s, never throws).
A bridge without `applyFixture` → `setup_failed`. The host (not the frontend) decides
whether mocks are allowed.

**Cloud (backend).** `COMMAND_NAMES` gets `applyFixture` and `releaseFixture`.
`applyFixture` creates a session like `open`. It calls
`controller.applyFixture(args.fixture, { allowNetworkMocks: true })`. `releaseFixture`
calls `controller.releaseFixture(args.token)`. The result shape is the controller's
(`ok`, `stage`, `error`, `summary`, `fixtureToken`, `url`, `title`). Frontend
`cloudBrowser.ts` forwards both, with a 120 s command timeout for `applyFixture`.
A mock left by a dead tab dies with the Steel session or with the next `applyFixture`.

**Desktop.** IPC commands `applyFixture` / `releaseFixture` through the existing
browser-command path. The user's real profile: before the controller runs, the desktop
allows every fixture field (user decision). Everything is scoped to the built-in
browser's partition `persist:penbrowser` and its browser tabs; the editor session is
never touched. `getCookies`/`setCookies` use that partition's `session.cookies`.
`fresh` (`resetSession(origins)`) closes the browser tabs, opens one blank tab and
clears cookies and storage ONLY for the fixture's own origins: the user's logins on
other sites survive. It never clears site data without an origin.

Network mocks are allowed on desktop (user decision: localhost apps are tested there).
The desktop target implements `routeRequests` with CDP `Fetch` per browser tab
(`webContents.debugger`), never through `session.webRequest` (profile-wide) and never
on editor tabs. Browser tabs opened while mocks are active get `Fetch.enable` too.
The remover disables `Fetch` on every tab and continues paused requests.
`allowNetworkMocks` is true there.

**Versions.** All three repos pin `#v0.2.14`. Merge order: backend, desktop, frontend.

## 2. UI

**`BrowseAgentIndicator`** (`src/components/chat/`), used for `browse_agent` parts in
`MessageList.tsx`. Unparsable output → falls back to `ToolCallIndicator`.

- Chip: icon, display name, status. Status words: `Preparing page...` while the
  handler is in the setup phase, `Running...`, `Done`, `Setup failed` (amber), `Error`.
  The phase comes from a small store keyed by `toolCallId`, set by the handler.
- Line `Setup: <path> · N steps · N API mocks · fresh session · N cookies · storage for N origins · N tabs · expect "<text>"`
  built from the tool input. Only counts for cookies and storage, never values. The
  expect part shows the selector, the text (up to 40 chars) or the URL pattern.
  After success it reads `expect ✓`.
- Success with mocks: `⚠ API responses were mocked. Data on these pages is not real.`
- `setup_failed`: `Stage: <setupStage> — <error>` and `The agent did not run.`
- Click opens Input/Output as today.

**Cloud banner.** `cloudBrowserStore` keeps the active mock count per chat. The handler
sets it after a successful apply on the cloud bridge and clears it on release. While
it is above 0, `CloudBrowserPanel` shows `⚠ N API mocks active` above the live view.

## Tests

- Backend: schema accepts/rejects `setup`; `applyFixture` creates a session and passes
  `allowNetworkMocks: true`; `releaseFixture` forwards the token.
- Desktop: every fixture field is allowed; the fixture reaches the controller with
  `allowNetworkMocks: true`, scoped to the `persist:penbrowser` partition. `fresh`
  clears only the fixture's own origins.
- Frontend: handler (setup → `session.run` with `setup`; failure → `setup_failed` with
  stage; release with the token in every outcome; no `url` passed together with `setup`);
  the card in its states (running with setup, done with mocks, setup failed, fallback);
  the banner; e2e: a stubbed `/api/chat` calls `browse_agent` with a `setup` whose apply
  fails and the card shows `Setup failed`.

## As built (after three review rounds)

- Package v0.2.15 exports `createFixtureSetup` (`agent/session`). The frontend uses it, so a
  token that arrives after an abort or deadline is still released. Its result JSON gets
  `setupApplied: true` only when the apply succeeded; the card's mocked-data warning and
  `expect ✓` key off it.
- The tool input is redacted (`src/lib/tools/browser/redactBrowseSetupInput.ts`) in the
  card's Input pane and in chat copy/export.
- The cloud banner count is owned by the run that set it (`toolCallId`).
- Desktop (pen-editor-desktop `673bcbc`): no gate; every field is allowed, scoped to the
  `persist:penbrowser` partition. Fetch enable is awaited and serialized per tab; a tab whose
  debugger is missing or detached fails the apply (stage `network`). `fresh` validates origins
  first and clears only cookies owned by each origin's host (parent-domain cookies survive;
  cookies ignore ports). Mocks are released when the driving editor tab reloads, crashes or closes.
- Known limits: desktop mocks reach every built-in-browser tab (never editor tabs); CDP Fetch
  misses cross-site iframes and service workers; the Fetch pattern is `*`.
