# Changelog

All notable changes to **pen-editor** (frontend) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While on `0.x`, minor bumps may include breaking changes.

## [0.76.0] - 2026-08-16

A second pass over the Glass material, driven by a side-by-side with a real iOS
tab bar. The headline is a bug this comparison exposed rather than the tuning.

### Fixed
- **The rim hairline vanished around the ends of a capsule.** `figma-squircle` clamps corner smoothing to the space available along a corner's edges (`maxSmoothing = budget / radius - 1`), so a fully-rounded shape — radius equal to half the short side — is actually drawn with a plain circular cap. The shader knew nothing of that clamp and kept bulging its superellipse corner per the node's authored `cornerSmoothing`, which walked the rim off the outline and let the surface's own alpha mask cut it away: a highlight along the straight sides, nothing around the caps. The SDF now applies the same clamp.

### Changed
- **Refraction is lensed rather than spread.** The displacement now follows a much steeper edge profile, so the backdrop bends inside a narrow band hugging the outline while the interior stays optically flat — the way iOS squeezes content at a glass edge. `refraction` still means roughly the same maximum displacement it did before.
- **The rim is a pair, not a line.** A thin darker contour sits immediately inside the lit hairline; that pairing is what reads as the material's own thickness, where a bright line on its own reads as a stroked outline. The hairline is also shaped by the light direction instead of running perfectly even.
- **Vibrancy lifts as well as saturates.** A gentle gamma curve on the sampled backdrop makes the material read lighter than the content behind it — iOS materials brighten midtones; black stays black.
- **Retuned defaults for newly added Glass** to match the above (stronger refraction, deeper bevel, more frost, more vibrancy). Existing documents are untouched: a stored value is never replaced by a default, only a missing or invalid one is.

### Removed
- **The Ultra Thin / Thin / Regular / Thick preset row.** Glass is parameters only now. The presets were four points in a space the sliders already cover, and they went stale the moment the defaults moved.

## [0.75.1] - 2026-08-13

### Changed
- **A running tool call now shimmers its label instead of spinning an icon**, and the reasoning chip shimmers "Thinking..." while it streams — a bright band sweeping the glyphs reads as "in progress" without a second moving element next to the text. It is a port of AI SDK Elements' Shimmer written as a plain CSS keyframe rather than a `motion/react` dependency, with highlight and base bound to the project's text tokens so the sweep stays brighter than the label in both themes, and `prefers-reduced-motion` switches it off.

## [0.75.0] - 2026-08-12

The frontend half of the backend's self-improvement loop (backend v0.38.0). The
agent can now change what it remembers and rewrite its own skills; the rule
this release implements is that it never does so invisibly. Inert unless the
backend has `MEMORY_ENABLED` / `SELF_SKILLS_ENABLED` on.

### Added
- **`pen.userId`** — an anonymous client id generated locally and stored in `localStorage`, sent with every chat request. It is what the backend scopes memory to. Not an account: a different browser, a different device, or a cleared storage is a different identity with empty memory.
- **Chips for the agent's writes to itself.** An in-turn `memory` call renders as "Память обновлена"; a `skill_manage` call names what happened and to which skill (created / updated / deleted / revived from the archive). Only a genuine success gets a chip — these tools never throw, so a refused write arrives as ordinary output and falls through to the regular indicator, where its error text is visible.
- **A toast for writes made after the stream closed.** The background review runs server-side once the turn is over, so the model has no way to mention it. A delayed check of `GET /api/memory/activity` announces one, saying which subsystem changed: memory, skills, or both. It reads by event-id cursor rather than a client timestamp — a skewed clock would otherwise silently suppress or repeat toasts — and carries a stable toast id so parallel chat tabs collapse into a single notification.

### Fixed
- The very first background review of a new user was swallowed. With no audit rows yet the server returns no cursor, so every check re-entered the baseline branch and never advanced past the one event the feature exists to announce. A baseline against an empty server now records a zero cursor, making "checked, saw nothing" distinguishable from "never checked".

## [0.74.1] - 2026-08-09

### Fixed
- **The cross-repo `contract` CI job went red when the desktop shell grew a menu item it doesn't forward.** `desktopMenuContract.test.ts` walks the real `pen-editor-desktop` menu template with a fake `actions` object and clicks every handler; `pen-editor-desktop` v0.2.0 added "Use this app for MCP", whose handler calls a shell-local action the fake didn't have, so every `pen-editor` push failed on `actions.useThisAppForMcp is not a function`. The fake is now a no-op proxy, keeping the contract scoped to the forwarded command ids — a rename of `forwardToActiveTab` still fails loudly, since nothing gets recorded.

## [0.74.0] - 2026-08-09

### Added
- **Watch the agent draw: `draw_vector` renders progressively while its arguments are still streaming.** The tool's newline-separated command script (`M`/`L`/`C`/`CLOSE`/`FILL`/`STROKE`/`END`) arrives over the ordinary AI SDK UI message stream as an `input-streaming` tool part; the chat reduces **only complete lines** into a transient Zustand draft that a dedicated Pixi overlay paints, so points and segments appear as the model emits them. A fully valid input is the single barrier to creating the real `PathNode` — one history entry, no partial commits. No WebSocket and no custom server data events were needed. A model that buffers its arguments doesn't lose the effect: a local replay (≤600 ms) plays the script back before the same final commit.
- **The desktop shell can host the MCP bridge itself (page side).** `desktopMcpBridge.ts` registers with the Electron shell through the optional `window.penDesktop.registerMcpBridge`, advertising protocol 1 and the MCP tool subset; the web build and older shells are unaffected no-ops. Only one bridge is ever active — `bridgeBootstrap.ts` sequences the desktop bridge first and suppresses the WebSocket one when it registered, since both would otherwise dispatch into the same handlers through separate queues. This is what lets `pen-editor-desktop` serve MCP with no local backend and no tokens.
- **Local development needs no MCP token.** The dev server reads `~/.pen-editor/mcp.json`, which `pen-editor-backend` writes in auto-token mode, and supplies the token and derived WebSocket URL through Vite `define`. Two independent gates keep it out of production bundles, where `VITE_*` values are inlined: `vite.config.ts` only uses the result under `command === "serve"`, and `resolveDevMcpHandshake` re-checks that itself. An explicit `VITE_MCP_WS_TOKEN` still wins.
- `get_editor_state` now reports `fileName`, so a client can tell which document answered. `documentStore` has no stable id, so none is invented.

### Fixed
- **The client copy of the design-system guidelines had drifted to under half the backend's** — missing wrap/gap, min/max clamping, and the whole component-and-variants block. Invisible while MCP ran `get_guidelines` on the backend; not invisible once every tool runs in the page. `toolContract.test.ts` now pins byte equality against the sibling repo.
- Three streaming-vector defects caught in review: AI SDK v6 deliberately leaves a truncated `input-streaming` tool part in `chat.messages` after Stop, which resurrected a ghost preview on the next send; an early `return` on failed final validation left the draft painted forever; and the overlay read the viewport scale without subscribing to it, so markers didn't rescale on zoom.

### Changed
- The transport-agnostic dispatch core (tool lookup, the serial queue that stops two agents interleaving scene mutations, the unknown-tool branch) moved out of `mcpBridge.ts` into `mcpDispatch.ts`. Liveness is now pinned to the socket a call arrived on via a generation counter — checking "is some socket open now" let a call queued behind a slow `batch_design` execute after a reconnect, mutating the document after the client had already been told the call failed. Teardown settles outstanding calls and stops the queue instead of leaving promises hanging.

## [0.73.0] - 2026-08-02

### Added
- **Auto layout now follows CSS flexbox the way Figma's July 2026 "updated auto layout" does — inside strokes count as `border`.** A new `resolveStrokeInsets` helper turns a node's `strokeAlign: 'inside'` stroke into per-side layout insets (center/outside strokes stay layout-inert `outline`s, and the default alignment is `center`, so existing documents barely move). The frame's own inside stroke now shrinks its content area exactly like padding: children start inside the border, hug frames grow to content + padding + stroke, and `fill_container` siblings distribute space border-box style — a thicker inside stroke earns proportionally more outer size so every fill sibling ends up with an equal inner content area, matching what the browser will do at handoff. The border also acts as a floor: a fill child never shrinks below its own stroke sum on either axis. Border-box treatment only applies to node types whose renderer actually honors `strokeAlign` (`rect`/`ellipse`/`polygon`/`path`/`frame`) — text and line nodes never reserve space for a stroke their renderer won't draw.
- **"Padding always gets the room it needs":** a fixed-size auto-layout frame is never laid out smaller than its padding + inside-stroke box (content space can no longer go negative — over-padded fill children used to compute negative sizes), and dragging a resize handle now stops at that same floor (`autoLayoutMinSize`), matching the engine instead of leaving a dead zone.

### Fixed
- **Every consumer of "where does content start inside this frame" now shares one helper, `resolveContentInsets` (padding + inside stroke).** The final review caught four call sites hand-rolling raw padding that would have drifted from the engine on stroked frames: auto-layout inference (`enableAutoLayoutOnFrame` would have shifted children by the stroke width, breaking its appearance-preservation invariant — the overflow/grow pass now also re-bases children sitting inside the border band), the drag-and-drop insertion indicator, the drop ghost's final position, and the hover padding/gap spacing overlay (the band geometry now matches where children land, while the label keeps showing the set padding value). Layout and renderer also share one per-side-stroke predicate (`hasPerSideStroke`), so layout can no longer reserve space for a per-side stroke configuration the renderer paints as nothing.

### Testing
- 27 new unit tests across `strokeInsets`, `yogaLayout` (edge insets, border-box distribution, cross-axis floor, regression pins for the two behaviors that already matched CSS: space-between overflow clamping and single-child-at-start), store-level stroke-mutation reflow, `enableAutoLayoutOnFrame` appearance preservation, drop-indicator and hover-overlay geometry.

## [0.72.6] - 2026-07-28

### Reverted
- **0.72.5's per-screen slide shaping is out — the long screens came out looking crooked.** Sizing each slide from the screen's own `width`/`height` did remove the crop (worst case 22% → 0.51% measured across the live feed), but with `items-start` on the grid the over-tall apps hang well below their neighbours and the rows stop reading as a grid. Every slide is back to the fixed `aspect-[390/844]` frame with `object-cover object-top`, and the grid back to its default stretch. That restores the crop on the 18 live screens taller than the frame — the third approach tried and rejected on looks, after 0.72.3's letterboxing and a capture-side height cap. The 0.72.2 Safari border-box fix is untouched.

## [0.72.4] - 2026-07-28

### Reverted
- **0.72.3's letterboxing of over-tall showcase screens is out — it looked worse than the crop it removed.** The rule was sound on paper (a screen taller than the 390:844 frame was fitted whole with `object-contain` instead of losing up to 22% of its bottom), but in the gallery it reads badly: the letterboxed screens sit smaller than their neighbours with gutters down both sides, and the over-tall captures carry a lot of dead space at the bottom anyway, so fitting them whole mostly buys empty pixels at the cost of a ragged-looking grid. `getScreenFit` and its tests are gone; every card is back to `object-cover object-top`. The underlying data problem is unchanged and still open: the capture pipeline doesn't cap a screenshot's height to the phone frame, so 18 of 65 live screens are taller than 390:844 and lose 4–22% off the bottom. Fixing that belongs upstream in the capture, not in how the gallery fits what it's given.

## [0.72.2] - 2026-07-28

### Fixed
- **Showcase screenshots were silently missing their bottom 2px in Safari, slicing through the app's tab bar.** `ShowcaseCard`'s card used a real `border`, which participates in border-box sizing; WebKit resolves the card's `height:100%` chain (button + image) against the border box, while Blink resolves it against the content box, so the 1px border made WebKit's content box 2px shorter than the aspect-ratio-sized border box. The `object-cover object-top` image then rendered 2px too tall for WebKit's content box and `overflow-hidden` clipped it off the bottom — invisible on Chromium, visible on real iOS Safari and Playwright's `webkit`. The card no longer has a `border` at all; the gray hairline is now a separate `aria-hidden` overlay div (`inset-ring-*`, an inset shadow) painted *after* the screenshot button in DOM order, so it stays layout-neutral (no border box) and still paints on top of the full-bleed image instead of underneath it — an inset shadow on the card itself would have been invisible behind the loaded screenshot.

### Testing
- New `webkit-mobile` Playwright project (`iPhone 14`, scoped to `showcase-*.spec.ts`) plus a new regression test in `showcase-smoke.spec.ts` asserting the screenshot image never extends past the card's padding box (0.5px tolerance) — this is the only way to catch a WebKit-vs-Blink layout divergence, since happy-dom has no layout model. CI's e2e job now installs `webkit` alongside `chromium`.

## [0.72.1] - 2026-07-28

### Fixed
- **Restored the gallery's off-centre slide fade, which 0.72.0 dropped.** The old Embla carousel dimmed its slides by distance, and I removed that along with Embla, reading it as a workaround for overlapping slides. It isn't — Mobbin does the same thing, and measuring the live site pins the exact law: an inline opacity per slide per scroll frame, `max(0, 1 - |offset from the scroller's centre| / stride)`, where one stride is the distance between snap points. It is now computed in the same rAF-throttled pass that tracks the centred slide, so at rest only the centred screen is visible and a swipe cross-fades between neighbours instead of dragging a hard-clipped crop across the card's edges.

## [0.72.0] - 2026-07-28

### Changed
- **The gallery's per-app screen scrolling is now a native CSS scroll-snap scroller, matching mobbin.com/discover/apps.** Embla (and the shadcn `ui/carousel` wrapper around it) is gone, along with the hand-written per-slide opacity effect that faked a fade between overlapping slides. Each card is an `<ol>` with `overflow-x:auto; overflow-y:hidden; scroll-snap-type: x mandatory` and `snap-center snap-always` items — the same structure Mobbin uses. That buys real trackpad/touch inertia and snapping for free, and, crucially, `overflow-y:hidden` means a **vertical** gesture over a card scrolls the page instead of being swallowed by the card. The panel's horizontal padding moved onto the scroller, so the neighbouring screens now peek at both edges the way they do on Mobbin. Slides no longer overlap, so `loading="lazy"` on the screen images works on its own.
- Hover arrows and the dot selector are kept (Mobbin has neither, but a plain mouse has no horizontal-scroll gesture, so without them the other screens would be unreachable). They drive `scrollBy`/`scrollTo` against measured DOM geometry. The carousel no longer wraps around — a native scroller has real ends — so at each end its arrow goes `aria-disabled` and dims rather than disappearing: unmounting it drops keyboard focus to `<body>` exactly when a keyboard user reaches the last screen, and the native `disabled` attribute is no better because `Button`'s `disabled:opacity-50` outranks the `opacity-0` that keeps arrows hidden until hover, leaving a dead arrow permanently on screen.
- `role="region"`/`aria-roledescription="carousel"` sit on the card panel, not on the `<ol>`: an explicit role on the list would strip its `list` role and orphan the `<li>`s.

### Fixed
- The scroller's scrollbar is hidden with a plain **unlayered** `.scrollbar-none` rule. As a Tailwind `@utility` it lost — the global `:where(*) { scrollbar-width: thin }` rules in `index.css` are themselves unlayered, and unlayered CSS beats layered CSS regardless of specificity — so a scrollbar sat across the bottom of every card.

### Testing
- New e2e in `showcase-smoke.spec.ts`: a horizontal wheel over a card scrolls it and lands snap-centred (asserted against real geometry), and a vertical wheel over the same card scrolls the document while leaving the card's `scrollLeft` untouched. That second half is the anti-hijack regression test, and e2e is the only place it can be observed — happy-dom has no layout or scroll model.

## [0.71.0] - 2026-07-28

### Added
- Responsive WebP `srcset` + inline LQIP placeholders for gallery screens, and a windowed slide mount so only the visible screens fetch a full image. 0.71.1 followed with eager loading for the selected slide. (Both released without a changelog entry; summarised here from commits `7fba58f`/`e10c275` so the history has no gap.)

## [0.70.1] - 2026-07-28

### Fixed
- **A grey band sat behind mobile Safari's status bar and address bar on the showcase.** `index.css` pins `html`/`body`/`#root` to `height:100%` + `overflow:hidden` so the editor at `/app` owns a fixed viewport it can pan and zoom inside. On iOS that 100% resolves against the *small* viewport, so the strips behind Safari's collapsing chrome fell outside the page box and painted with the body background (`--color-surface-base`, `#f5f5f5`) instead of the gallery. The lock is now lifted for `/` alone, via a `route-showcase` class that `ShowcasePage` puts on `<html>` while it is mounted — `/app` is untouched. The gallery scrolls the document, which is also the only thing that lets Safari collapse its chrome at all; `viewport-fit=cover` plus `env(safe-area-inset-*)` padding on the header and grid keep content clear of the system UI while the background runs edge to edge, and `theme-color` goes white for as long as the showcase is on screen.

### Testing
- The phone-scroll e2e spec had been red on `main` since the carousel landed: its fixture gave all 12 screens the same `runId`, and one card is one *run*, so they collapsed into a single carousel that fit on screen with nothing to scroll. It now uses distinct runIds, and asserts the **document** scrolls — with a check that no ancestor of `<main>` has taken the scroll back — rather than reaching for the parent of `<main>`.

## [0.70.0] - 2026-07-28

### Added
- **Click a screen in the gallery to copy its id.** Pinning a screen to the front of the feed (`showcase:pin -- --screen <uuid>`, backend v0.33.0) needs the screen's uuid, which previously meant querying Postgres by hand. Cards are real `<button>`s, so Enter/Space work too, and a capture-phase listener on the carousel root swallows the click that ends an Embla drag — swiping never copies.

## [0.69.4] - 2026-07-28

### Fixed
- **The showcase applies a new version itself instead of asking.** 0.69.3 gave the update prompt somewhere to render on `/`, but the prompt was still the only way a waiting worker ever activated — so a visitor who refreshed the gallery on a stale bundle (mobile Safari, several reloads) kept getting the old one, with no toast in sight: the toast that would have offered the update lives in the build they can't reach. The gallery holds no unsaved state, so `PwaUpdateGate` now sends `SKIP_WAITING` and reloads on its own the moment an update is ready, on every route except the editor. `/app` keeps the prompt — it may hold an unsaved document. One auto-apply per tab (`sessionStorage`); if the activation doesn't take, the next load prompts rather than reloading again.

### Note
- A client already stuck on a pre-0.69.4 bundle can't be reached by this fix — it needs code it never downloads. Closing every tab of the site (so no client remains) lets the waiting worker activate, and the next visit is current.

## [0.69.3] - 2026-07-28

### Fixed
- **"A new version is available" never appeared on the showcase.** When the gallery took over `/` and the editor moved to `/app`, `<PwaUpdateToast />` and the sonner portal stayed mounted inside the editor's `App`. `registerServiceWorker()` still runs on every entry, so an update detected while the user was sitting on the showcase set `pwaStore.updateReady` and then had nowhere to render — the prompt only turned up if you happened to walk into the editor. It is mounted above the route split now (`PwaUpdateGate`), bringing its own toast portal on the routes the editor doesn't own. The gate loads sonner and the toast chrome through `lazy()`, only once an update actually exists, so the showcase entry chunk is unchanged (~46 kB) instead of carrying ~125 kB of toast machinery it almost never needs.
- Present mode still hides the prompt, now via `pwaStore.toastSuppressed` rather than by unmounting it — `updateReady` is untouched, so the prompt returns on exit.
- **The e2e job on CI went red for every push**, unrelated to the change being pushed. Since the editor became a lazy route chunk, the first spec to open `/app` waits for the dev server to transform App + PixiJS, which on a cold CI runner overruns Playwright's 5s expect default (a retry against a warm server took 27s and passed). Specs now wait for the canvas through a shared `expectEditorMounted` helper sized for that first load.

### Known issues
- ~~**`/app` returns 404 on the deployed host.**~~ Resolved host-side: `GET /app` on `pen-editor.onrender.com` answers 200 with the SPA shell as of 2026-07-28.

## [0.69.2] - 2026-07-28

### Security
- **Every production dependency advisory is resolved; `npm audit --omit=dev` is clean.** The non-breaking half came from `npm audit fix`: a critical `seroval` deserialization type confusion, high-severity path traversal in `postcss` and host confusion in `fast-uri`, plus `dompurify`, `body-parser`, `hono` and `@hono/node-server`.
- **react-router 7.18.1 → 8.3.0** for GHSA-qwww-vcr4-c8h2 (high — CSRF bypass letting an action run before the 400 response in RSC mode). Nothing was backported to the 7.x line, so the major is the only fix available. The editor only uses `BrowserRouter`/`Routes`/`Route`/`Navigate`/`Link`/`MemoryRouter`, none of which changed, so no source edits were needed.

### Known issues
- The dev-only `brace-expansion` advisories (glob-pattern DoS, reached through minimatch 3/5/9 under eslint, typescript-eslint and vite-plugin-pwa) are knowingly left in place. Only 5.0.8 carries the patch and nothing landed on 1.x/2.x, so an `overrides` pin to `^5.0.8` breaks `npm run lint` outright — minimatch@3 cannot consume the v5 API. `npm audit fix --force` would pull eslint@10 and still not reach zero: the `vite-plugin-pwa → workbox-build → ejs → jake → filelist → minimatch@5` chain has no fixed release at all, and vite-plugin-pwa is already at its latest version. None of it ships to users.

## [0.69.0] - 2026-07-27

### Fixed
- **Turning on auto-layout no longer blows the layout apart.** Enabling it on a frame with manually positioned children reset everything to horizontal, gap 0, zero padding and tree (z-)order, so a tidy vertical stack with 24px gaps came back as a squashed row in creation order. Enabling auto-layout is supposed to preserve appearance, the way it does in Figma. Direction, gap, padding, cross-axis alignment and the child order are now all inferred from the children's current geometry: direction from how their axis projections overlap, gap from the actual spacing (equal gaps taken as-is, otherwise the median), padding from the children's bbox against the frame, and the order from position along the main axis rather than z-order. `justifyContent` is deliberately always `flex-start` — `space-between` and an explicit gap cannot both be honoured, and `flex-start` plus a real gap reproduces the original geometry exactly.
- **"Wrap selection in an auto-layout frame" had the same bug with different defaults** — it hardcoded column, gap 0 and zero padding, and inserted children in selection order. It now runs the same inference.
- A child sticking out past the frame edge is no longer silently yanked inside when auto-layout turns on. Auto-layout padding cannot be negative, so the frame grows (and shifts) to enclose its children instead, keeping every node where it was on screen.

## [0.68.0] - 2026-07-27

### Fixed
- **The agent read every auto-layout child back as 0×0, stacked at one coordinate, and then "fixed" layouts that were actually fine.** `batch_get` and `batch_design`'s `createdNodes` both serialize through `serializeNodeToDepth`, which spread the raw flat-store fields — and a node sized `fill_container`/`fit_content` carries a `0` placeholder there, since its real size exists only as a layout result. The canvas rendered correctly the whole time; only the agent's view was wrong, so it would spend a session debugging blind and hardcoding pixel sizes. Serialization now resolves effective size through the layout store and overrides `x`/`y` for children of auto-layout frames with the yoga-computed parent-relative position, falling back to raw fields for detached nodes.
- **`get_screenshot` returned a blank image for every embed.** Embeds live in a Shadow-DOM overlay above the canvas and their Pixi container is deliberately empty, but both screenshot paths extracted pixels from the Pixi scene graph only. This is why agents across many sessions independently concluded that picsum/Unsplash/OpenStreetMap images "don't load inside embeds" while the human looking at the live canvas saw them load fine. Embed nodes now route through `renderHtmlToCanvas`, and a failed render returns a descriptive error instead of a silently blank image. An embed sized `fill_container` also no longer reads the `0` placeholder and reports a confidently wrong "HTML may be empty, or a cross-origin image" error.
- `serializeNodeToDepth` resolved the store's whole tree once per node, making a read of N nodes in an M-node document cost O(N×M) on the `batch_get`/`batch_design` hot path. `flattenTree` is now memoized on the tree reference, store lookups are hoisted out of the recursion, and fixed-size nodes under a non-auto-layout parent skip layout resolution entirely.

### Changed
- **A `batch_design` call over the 25-operation cap now executes its first 25 operations instead of being discarded.** Previously the whole script failed at parse time — the top tool error in agent traces, and the costliest, since the model had to regenerate everything. The handler now runs the first 25 and returns a resumption point: `truncated`, `operationsSubmitted`, `bindings` (binding name → real node id), `remainingOperations` (the skipped operations verbatim) and a `note` explaining how to continue. `bindings` is what makes resuming possible at all: bindings live only within one call, so the skipped operations reference names that no longer exist on the next turn. `remainingOperations` is capped at 8000 characters but always carries at least one operation, and says so explicitly when the list is cut short. Responses for batches within the cap are byte-identical to before.

### Added
- **`export_layers_svg` tool** — serializes given node ids (or the current selection) to an SVG data URI plus intrinsic size, reusing the same serializer as "Copy as SVG", so the agent can drop real vector art into embed HTML instead of reconstructing paths by hand. Raw markup is capped at 200k chars so an accidental whole-screen export returns an actionable error rather than dumping a huge blob into the model's context. The exported viewBox is padded for rotation overflow and blur/shadow bleed, since an SVG loaded through `<img>` always clips to its viewBox.

## [0.66.3] - 2026-07-23

### Fixed
- **Linked prototype elements no longer look different (no underline, no link color) and no longer break layout.** The `<a>` wrapper injected around a non-anchor element is now styled `display:contents;color:inherit;text-decoration:none`, so a linked card/tab is visually identical to an unlinked one and the wrapped element keeps its place in grid/flex layouts (an inline `<a>` around a block card previously became the layout item).

### Changed
- **Prototype export now treats a header avatar / profile photo as a clickable candidate** (`avatar`/`profile`/`account` class stems), so the AI can wire it to a profile/settings screen. Previously these text-less image elements were never extracted, so they could never be linked.

## [0.66.2] - 2026-07-23

### Fixed
- **Prototype export still didn't link real app screens** (e.g. a plant card on a home screen never navigated to its detail screen). Root cause: candidate extraction only matched semantic clickables (`<a>`/`<button>`/`[role=button]`/`[onclick]`), but real design embeds mark navigational cards, tabs, and list rows as styled `<div>`s — so those screens produced zero candidates and nothing could be linked, no matter how good the AI/heuristic step was. Extraction now also picks up clickable-looking elements (a curated set of interactive class stems — `card`/`tab`/`nav`/`item`/`tile`/`row`/…, or inline `cursor:pointer`), keeps only the innermost when they nest, never treats content inside an existing `<a>`/`<button>` as its own candidate (avoids nested anchors), and forwards each candidate's `class` as a hint so the link-graph reasoner can tell a `plant-card` from a `tab`.

## [0.66.1] - 2026-07-23

### Fixed
- **Prototype export: screens weren't getting linked.** The AI link step was the sole linker and often returned an empty graph. Now each screen is keyed by a stable slug and sends a visible-text content excerpt so the model reasons over real content and returns ids it can echo reliably; a deterministic heuristic pass always wires candidates whose label clearly names another screen (e.g. a "Pricing" link → `pricing.html`), merged with the model's links (heuristic wins on conflict); and if the backend call fails, linking falls back to the heuristic instead of producing nothing.

## [0.66.0] - 2026-07-23

### Added
- **Clickable prototype export** (PROTO-01): select 2+ embed screens and a **Prototype** section appears in the properties panel. "Export prototype (.zip)" extracts each screen's clickable elements, asks the backend (`/api/prototype-link`) to wire a navigation graph, applies it as native relative `<a href>` links (no JS injection — works from `file://`), and packages one standalone `.html` per screen plus an `index.html` redirect to the top-left start screen. Each file preserves its `<head>` styles/links so the prototype keeps its CSS. Zips via `fflate`.

## [0.65.0] - 2026-07-23

### Added
- **MCP bridge**: when built with `VITE_MCP_WS_TOKEN`, the editor tab connects to the backend's `/api/mcp/ws` so external MCP clients (Claude Code etc.) can read and edit the open document through the same tool handlers the built-in chat uses. Serial tool-call queue, exponential reconnect backoff with jitter, activity pings on focus/visibility, and a status dot with tooltip next to the file name.
- `get_screenshot` accepts an omitted `nodeId` and falls back to the single selected node.

### Fixed
- `get_screenshot` no longer doubles the `data:image/png;base64,` prefix (Pixi's `extract.base64` already returns a full data URL).

## [Unreleased]

## [0.64.0] - 2026-07-23

### Added
- **Eyedropper: press `I` to set the fill from any color on screen.** With one or more elements selected, `I` opens the native screen-color picker (Figma-style) and applies the sampled color as the Fill of every selected node. Cancel with Escape for no change; picking across a multi-selection is a single undo step. Feature-detected — a no-op in browsers without the EyeDropper API and in view mode.

## [0.63.0] - 2026-07-23

### Added
- **The design agent asks clarifying questions as an interactive form in the chat.** When the agent needs direction — mandatory before it creates anything new on the canvas — it renders an inline form instead of guessing: single/multi chips, a dropdown, and text fields, each with a "Decide for me" option (delegates the choice back to the agent) and an "Other…" free-text field. Answering resumes the agent with your choices; while a question is pending the composer is blocked so your answer can't be stranded. Requires backend 0.25.0 (the `ask_user` tool).

## [0.62.0] - 2026-07-23

### Fixed
- **Pasting complex Pixso selections now reproduces them faithfully.** Heavily
  componentised Pixso designs previously lost most of their content on paste
  (fields dropped, text collapsed to empty, instance-swap slots stuck on a
  "◇ Swap" placeholder). The importer now resolves Pixso/Figma **component
  properties** — text, boolean visibility, and instance-swap values — against
  each instance's assignments and its master's defaults, so bound text and
  swapped-in components appear as authored.
- **Auto-layout fidelity for pasted Pixso frames.** Mapped Pixso's auto-layout
  child fields (absolute positioning, counter-axis fill, per-side padding) to
  the editor's layout model, and grow auto-layout hug frames to fit their
  (swap-expanded) content so a clip mask no longer collapses over it — a
  multi-field form pastes with every field visible.

## [0.61.0] - 2026-07-22

### Added
- **Paste from Pixso.** Copying elements in the Pixso v2 web editor (Cmd+C) and
  pasting into pen-editor (Cmd+V) now inserts native scene nodes, mirroring the
  existing paste-from-Figma path. Pixso writes a `text/html` clipboard payload
  marked with `<!--PixsoClipboardData-->`, carrying a base64 `data-fic` blob:
  a `pixso-kw` header, a zstd frame, and a kiwi message on Pixso's own schema
  (`pixso.binary`, bundled). The new `src/lib/pixsoPaste/` module detects the
  sentinel, extracts and zstd-decompresses the payload, decodes it with
  `kiwi-schema` (applying a +1 type-index remap, since Pixso's kiwi encoder has
  one extra builtin type), normalizes it (colors 0–255 → 0–1, `pixsoNodes` →
  `nodeChanges`) into a Figma-shaped message, and reuses the tested
  `figmaToScene` converter. Wired into `handlePaste` beside the Figma/h2d
  branches; decode is offline (schema bundled, no network). Image fills come in
  as placeholders with a toast — Pixso, like Figma, omits image pixels from a
  plain copy. Tests run against three real captured payloads (rect, text,
  frame).

## [0.60.1] - 2026-07-22

### Fixed
- **Repeated double-click drill-down at the same cursor position.** Drilling
  into nested containers stopped after one level when double-clicking again
  without moving the mouse: the browser keeps incrementing the click train's
  `detail` (1,2,3,4…) for rapid clicks at one spot and only dispatches native
  `dblclick` at exactly 2, so clicks 3+4 never produced an event. Double-click
  detection is now manual (`doubleClickDetector.ts`, wired into pointerup):
  every pair of rapid clicks (≤500ms, ≤5px) fires and resets, so each
  successive double-click drills one level deeper. `handleDblClick` behavior
  (text edit, embeds, instance drill) is unchanged. Also: `pointercancel` is
  excluded explicitly, the pointerup `button` check is dropped (WebKit touch
  `button = -1` quirk), the pairing window is 500ms to match stock OS
  double-click defaults, and pointerup computes screen coords once.

## [0.60.0] - 2026-07-21

### Changed
- **Plugins moved from a modal into the left sidebar.** The plugins manager
  now lives as a rail section in the Toolbox panel (below Assets) instead of
  a modal dialog; Run is gated by read-only (view) mode.

## [0.59.0] - 2026-07-21

### Added
- **Plugin UI-kit expanded to cover every app-analog primitive.**
  `PLUGIN_UI_KIT_STYLES` grows from 9 to 26 `.pen-*` classes — adding `badge`,
  `card`, `separator`, `slider`, `tabs`/`tab`, `alert`, `table`, `field`,
  `help`, `icon-button`, `button-group`, `input-group`, `heading`, `muted`,
  `kbd` and `link` on top of the original controls — so the design agent has an
  editor-matching, live-theming analog for every `src/components/ui/` primitive
  that renders faithfully inside a sandboxed static plugin iframe. All classes
  reference only `THEME_CSS_VARS` tokens (no new theme var); the backend
  `/plugin` skill catalog stays in sync, guarded by the cross-repo
  `pluginAllowlistContract` test. Pairs with backend 0.24.0.
- **Offline indicator beside the document name.** A crossed-cloud (`CloudSlash`)
  glyph with a tooltip now appears next to the file name while the browser is
  offline, driven by `useOnlineStatus`; documents are local-only, so "offline"
  and "document is local-only" are the same condition.

## [0.58.0] - 2026-07-21

### Changed
- **Primary buttons restyled: white with an outline instead of black fill.**
  Light theme `--primary` is now white with near-black text and a visible
  border on the Button default variant (hover darkens slightly via
  color-mix); dark theme keeps the light button, now also outlined. The
  plugin UI kit's `.pen-button-primary` mirrors the same recipe. Ink-colored
  consumers of the old `--primary` (default badge, link variants, field
  checked-highlight, auto-layout dot) now use `--foreground` so they keep
  their contrast.

## [0.57.0] - 2026-07-21

### Added
- **Plugin UI kit (plg-06).** The plugin sandbox now ships a base stylesheet
  baked into every plugin document: `.pen-button` / `.pen-button-primary`,
  `.pen-input`, `.pen-textarea`, `.pen-select` (custom caret, no native
  chrome), `.pen-label`, `.pen-checkbox`, `.pen-row`, `.pen-stack` — styled
  on the editor's own tokens (`--primary`/`--primary-foreground`,
  `--secondary`, `--input`, surface/text vars, all now injected and
  live-updating on theme switch) and mirroring the real primitives' recipes
  (borderless 24px inputs, 28px buttons, SelectTrigger-style select).
  AI-generated plugins now look native instead of hand-rolling CSS; the
  `/plugin` skill documents the class catalog, and a cross-repo contract
  test keeps the catalog and the stylesheet in sync.
- Floating panels and sidebar headers alignment pass (concurrent session).

## [0.56.0] - 2026-07-21

### Added
- **UI plugins: floating panels (plg-04).** Plugins that declare `ui: {width,
  height}` now open in a draggable, resizable floating panel (titlebar with
  icon, name and close; the plugin's sandbox iframe fills the body) instead of
  running hidden. `pen.ui.resize(w, h)` resizes the panel from inside
  (clamped); closing the panel — or the plugin calling `pen.close()` — tears
  the instance down cleanly. Re-running a plugin keeps the panel where the
  user put it. Headless plugins are unchanged.
- **Theme in plugin iframes.** The host bakes the editor's theme token CSS
  variables and `data-theme` into the plugin document and pushes live updates
  on light/dark switches via a single host-level broadcaster and a
  ready-handshake (no lost messages during iframe load).
- **Dev Mode stays read-only.** Mutating `pen.tools.run`/`pen.scene.batch`
  calls from plugins are rejected while Dev/Inspect Mode is active
  (read-only tools keep working); leaving edit mode stops all running
  plugin instances.
- Shared `usePointerDragGesture` hook now backs the draggable popovers,
  panel drag and panel resize (one pointer-capture implementation instead
  of three copies).

## [0.55.0] - 2026-07-21

### Added
- **Plugin library & manager (plg-02).** Installed plugins now persist in
  IndexedDB (`src/utils/pluginDb.ts`, built on a new shared
  `createIndexedDbStore` factory also adopted by the custom-font store) with an
  in-memory zustand `pluginStore` (hydration-safe: installs await the initial
  load, colliding ids get a fresh id instead of overwriting). New
  **Plugin Manager** panel: run, rename inline, view code (read-only), delete
  with confirmation, export as JSON and import from JSON
  (`src/lib/plugins/pluginTransfer.ts`). Command palette gains a **Plugins**
  group — one run-command per installed plugin (`mutatesScene`, hidden in
  Dev Mode; the manager's Run button is likewise disabled there) plus
  "Manage plugins…".
- **AI plugin generation (plg-03, pairs with backend 0.23.0).** New
  client-executed tool handlers `create_plugin` / `update_plugin` /
  `list_plugins` (`src/lib/tools/plugins/`): the agent writes plugin code in
  chat, it lands in the library ready to run, and iterates via
  list → update. Strict validation (required fields, 100 KB code cap,
  positive panel size, icon type checks that never wipe an existing icon).
  Covered by unit tests, an e2e smoke (stubbed `/api/chat` streams
  `create_plugin` → plugin installs and runs in a real sandboxed iframe) and
  two cross-repo contract tests — tool names and the `/plugin` skill's
  allowed-tools list are both CI-guarded against drift.

## [0.54.0] - 2026-07-21

### Added
- **Noise effect (Figma parity).** New `noise` member of the `effects` stack —
  film-grain "random pixels" over a layer, mirroring Figma's Noise effect
  (Config 2025) and its REST-API schema: `noiseType` mono/duo/multi, `color`
  (+`secondaryColor` for duo, `opacity` for multi), `noiseSize`/`noiseSizeY`
  (non-uniform cells), `density` 0–1, optional per-effect `blendMode`. Up to
  2 noise effects render per node (first two visible win, like Figma).
  - Deterministic hash-based white noise (`src/lib/noise/generateNoise.ts`):
    one RGBA sample per cell, seeded from node id — stable across frames,
    undo/redo, and exports.
  - Rendered in Pixi as nearest-neighbor masked sprites above the node's
    content (`src/pixi/renderers/noiseEffectHelpers.ts`): zoom-crisp cells,
    native per-sprite blend modes, cheap restretch on sub-cell resizes
    (texture regenerates only when cell counts or noise params change), and
    mask rebuilds on corner-radius/smoothing changes. Textures are freed via
    a container-destroy hook (no leak on node deletion).
  - Effects panel: Noise row with Mono/Duo/Multi selector, color+opacity,
    Size X/Y, Density and blend-mode controls; "Add → Noise" disables at the
    2-effect cap.
  - AI: `batch_design`/`set_styles` accept noise entries in `effects`
    (backend 0.22.0 documents the shape); noise round-trips `.pen` save/load,
    effect styles, and the public `.pen` export.
  - Cross-surface wiring: PPTX export rasterizes noise-bearing shapes,
    Selection Colors aggregates/remaps noise colors, Dev Mode inspect shows
    the effect (color swatch hidden for multi), HTML export intentionally
    drops noise (no CSS analogue — same as Figma's SVG export).

### Known limitations
- Figma clipboard paste does not yet import Figma NOISE effects (needs a real
  payload capture); a 3rd+ noise effect from AI/import renders inert (only
  the first two draw) while still listed in the panel; Texture (rough-edge)
  effect is a separate follow-up task.

## [0.53.0] - 2026-07-21

### Added
- **Plugin runtime (generative plugins, stage 1 of 4 — plg-01).** Foundation
  for AI-generated plugins à la Figma's Config 2026 generative plugins: a
  plugin is a JS string executed in a sandboxed iframe (`sandbox="allow-scripts"`,
  null origin, hidden/headless in this stage) that talks to the editor
  exclusively through an async `pen.*` API over a validated postMessage RPC
  bridge (30s timeout, source-window checks on both sides). The API core is
  `pen.tools.run(name, args)` over an allowlist of 20 existing AI tools —
  `batch_design` transactionality and single-undo-entry semantics come for
  free — plus sugar: `pen.scene.batch/get`, `pen.selection.get/set`,
  `pen.viewport.zoomTo` (absolute-coordinate aware), `pen.notify`,
  per-plugin-namespaced `pen.storage`, `pen.on("selectionchange")`,
  `pen.close()`. New modules under `src/lib/plugins/`
  (`types` / `toolAllowlist` / `pluginApi` / `bootstrap` / `pluginBridge` /
  `pluginHost`), 32 unit tests + a real-iframe Playwright smoke
  (`e2e/plugin-runtime.spec.ts`); dev-mode `window.__pluginHost` for testing.
  Design spec: `docs/superpowers/specs/2026-07-21-generative-plugins-design.md`.
  Next stages: plugin library + manager UI (plg-02), AI generation tools +
  `/plugin` skill (plg-03), visible plugin panels (plg-04).

### Changed
- Internal: groundwork for a noise effect (deterministic hash-noise pixel
  generator, `NoiseEffect` type/factory, constant cell size on resize) — not
  yet user-facing; the effect ships in a later release.

## [0.52.1] - 2026-07-20

### Changed
- **Internal: deduplicated production code across the codebase.** A jscpd scan
  (`--min-tokens 70`) found 49 exact clone pairs in production code; 43 were
  extracted into shared helpers (the remaining two are intentional light/dark
  theme blocks in `index.css`, and test-file clones were left as is). New shared
  modules include `LruTextureCache`, `buildShapeMask`, `fillLayerInsertIndex`
  (pixi renderers), `PointerGestureHandlers`, `addDrawnNodeWithAutoParenting`,
  `computeHandleDragOrigin`, `computeConnectorBounds` (pixi interaction),
  `computeUpdatedNode` (sceneStore mutators), `ToolDropdownGroup`,
  `MediaCropControls`, `useEmbedScreenRect`, `useConvertEmbedToDesign`
  (components), and `applyStyleToNodes`, `svgGradientDef`, `createQuoteScanner`
  (lib). Net −62 lines with 11 new helper modules; no behavior changes — AI tool
  handler signatures/results, command-palette ids, memoization patterns, and the
  dirty-tracking convention are all preserved.

## [0.52.0] - 2026-07-20

### Added
- **Pasted/converted colors auto-bind to design Variables instead of arriving as
  hardcoded hex.** When HTML is pasted (an html.to.design capture) or an embed is
  converted to design, color styles that trace back to a CSS custom property now
  bind to a color `Variable` minted from that token's definition, so they
  re-resolve on theme switch: `background-color → fillBinding`, `border-color →
  strokeBinding`, and text `color →` the text node's fill binding. The capture
  bundle now emits the file's document-root design tokens (`:root`/`html` +
  `.dark`/`[data-theme=dark]` toggles) as `{light, dark}` values, so an imported
  token carries both theme values. Variables dedupe by name against the store
  (first import wins); the resolved hex stays as each binding's fallback. Fonts
  and spacing remain resolved for now — the scene model has no binding for
  typography or auto-layout spacing yet (`src/lib/h2dPaste/h2dToScene.ts`,
  `src/lib/h2dCapture/captureEmbed.ts`, re-vendored `src/vendor/h2dCapture/`;
  capture side in the sibling `html-capture` repo's `extractVariableDefinitions`).

## [0.51.1] - 2026-07-19

### Fixed
- **`batch_design` "Unresolved binding" when a node's `nodeData` echoed an `id`
  field (FIR-51).** Models occasionally include an `id` field in a node's data
  (e.g. mirroring a `binding=I(...)` name). `mapNodeData`'s pass-through default
  copied that `id` straight onto the created node, overriding the auto-generated
  id — and the old code then *deleted* the id entirely, leaving the node with no
  id at all. Every later reference to that node's binding in the same script then
  resolved to `undefined` and threw `Unresolved binding`, forcing the agent into
  a wasted `batch_get` round-trip. The mapper now strips any stray `id` from
  `nodeData` *before* the node is built, so the generated id always stands, and
  emits a one-line guidance issue telling the model to use `binding=I(...)`
  instead (`src/lib/tools/batchDesign/nodeMapper.ts`).

### Changed
- **Clearer "Unresolved binding" error.** When a binding genuinely cannot be
  resolved, the error now names the missing binding, lists the bindings that
  *are* defined so far in the script (so a typo is obvious), and explains that
  bindings are scoped to a single `batch_design` call and are not a node's
  `name`/`id` — with the concrete fix (pass the real node id as a quoted string).
  Lets the model self-correct without a `batch_get`
  (`src/lib/tools/batchDesign/executor.ts`). Duplicate guidance issues are now
  de-duplicated before being returned (`src/lib/tools/batchDesign/index.ts`).

## [0.51.0] - 2026-07-19

### Added
- **Auto-retry for chat network errors.** `/api/chat` requests that fail at
  the fetch level (connection blip, dropped connection before the stream
  starts) are now retried automatically — up to 3 retries with a 5 s pause,
  covering both the first request and every auto-continuation request of the
  tool loop. While retrying, the chat shows a neutral "Network error —
  retrying in 5 s (attempt N/3)…" status line instead of the red error, which
  now only appears after retries are exhausted. Stop cancels a pending retry
  pause immediately. HTTP error responses and mid-stream drops are
  deliberately not retried (a mid-stream retry would re-execute tool calls
  against the scene). Going offline mid-retry surfaces the canonical offline
  message instead of a raw browser error
  (`src/lib/retryFetch.ts`, `useDesignChat`, `ChatPanel`).

## [0.50.2] - 2026-07-19

### Fixed
- **Phosphor icons vanished when converting an embed to design.** The
  icon-font glyphs live entirely in `::before`/`::after` pseudo-element
  content, which the h2d capture→scene converter drops (and the Phosphor font
  doesn't exist on the Pixi canvas anyway). Before capture, every
  `ph`/`ph-<weight>` icon element's glyph is now swapped for the matching
  `@phosphor-icons/core` SVG inside the capture iframe — sized from the
  element's `font-size`, colored from its computed `color`, with both glyph
  pseudo layers suppressed (duotone renders in `::before` AND `::after`) — so
  conversion emits icons as SVG image fills. Icon inlining is strictly
  best-effort and per-icon: an unfetchable or unprocessable icon drops (the
  old behavior) without failing the conversion, `font-size: 0` icons stay
  hidden, and each distinct icon asset is fetched once and cached for the
  session (`src/lib/h2dCapture/phosphorIcons.ts`).

## [0.50.1] - 2026-07-19

### Fixed
- **Web/icon fonts in embeds rendered as tofu on the live canvas.** Embed
  `htmlContent` mounts into a Shadow DOM, and Chrome only registers
  `@font-face` rules from document-level styles — so fonts referenced via
  `@import`/`<link>` inside the embed (e.g. the Phosphor icon font the AI agent
  now emits) never loaded on the canvas. External font stylesheets are now
  extracted from embed HTML and hoisted to `document.head` on every shadow-DOM
  mount (`mountHtmlWithBodyStyles`: live canvas, inline embed editor, and the
  natural-size measurement path), deduped per URL. Extraction logic lives in
  `src/utils/fontStylesheets.ts`.
- Security: hoisted stylesheets are restricted to a tight host allowlist —
  `fonts.googleapis.com`, plus `unpkg.com` only for `/@phosphor-icons/` paths —
  since document-level CSS could otherwise restyle the whole app.
- A failed font-stylesheet load no longer wedges the dedupe cache (the broken
  `<link>` is removed so a later mount retries); protocol-relative URLs are
  normalized instead of dropped; `rel="alternate stylesheet"` links are ignored.

## [0.50.0] - 2026-07-19

### Fixed
- **Per-side stroke follows corner radius (bug-17).** A node with a per-side
  stroke (`strokeWidthPerSide`) drew each side as a straight segment and
  ignored `cornerRadius`/`cornerRadiusPerCorner`, leaving square corners on a
  rounded node while the fill was rounded. When all four sides share one width
  and the node has a radius, the stroke now follows the shared rounded contour
  (reusing the fill's path via Pixi's stroke `alignment` for inside/center/
  outside). Unequal per-side widths keep the straight-segment rendering as a
  documented limitation (no single contour to key a radius off of).
- **Shadows no longer clip or disappear on zoom (bug-19).** After the raster/
  culling perf work, drop/inner shadows could vanish or get clipped as the zoom
  changed. Three fixes: (1) the culling spatial index now expands each node's
  rect by its effect overhang (`|offset| + blur + spread`) so a node whose
  shadow bleeds onto the viewport is no longer culled with its own rect;
  (2) the raster cache sets an explicit `boundsArea` (from the container's real
  local bounds, so a non-clipping frame's overflow and outside strokes are
  preserved) expanded by the effect margin, since Pixi's bake bounds ignore
  filter padding; (3) the shadow `BlurFilter` gets explicit padding ≥ blur and
  `quality` 3→4. Zoom-adaptive blur resolution is deliberately deferred (perf).

### Changed
- **Play mode pins slides to the top-left, hides frame names (bug-18).** In
  Play (present) mode a slide is now always pinned to the window's top and left
  edge instead of being centered vertically (when it fit) or around the
  midpoint when the MIN/MAX scale clamp bound. Top-level frame-name labels are
  no longer drawn in Play and return on exit. `viewportStore.fitToWidth`'s
  clamped-centering contract changed accordingly (only caller is the present
  controller).

## [0.49.0] - 2026-07-19

### Changed
- **Shared paint-stack row shell (arch-06).** The "stack row" — drag handle +
  popover trigger (swatch + summary) + visibility/remove buttons + drag-to-
  reorder state — was written three times across the Fill, Stroke, and Effects
  sections (~150 duplicated lines, already drifting). It now lives once in
  `src/components/properties/stackRow.tsx` (`StackRowShell` + `useDragReorder`),
  and the shared `PaintSwatch` / `BlendModeDropdown` / `FILL_ROW_TRIGGER_CLASS`
  pieces moved out of the `FillSection` file into that honest shared-ui module.
  Pure extraction — no behavior change; drag-to-reorder stays off in Effects.
- **Shared media-fill editor controls (arch-07).** The mode+crop-toggle row,
  the 4-field crop grid, and the preview + hover-reveal "Replace…" overlay were
  copied across the Image, Video, and Pattern fill editors (~90 duplicated
  lines). They now live once in `src/components/properties/mediaFillControls.tsx`
  (`CropRectGrid`, `MediaModeRow`, `MediaPreviewReplace`). Pure presentational
  extraction — no behavior change.

### Fixed
- **Unified canvas viewport metrics (arch-08).** The canvas viewport size was
  derived in 9 places with three different fallback policies
  (`window.innerWidth - 480`, plain `window.innerWidth`, a raw rect). All 9 now
  read from a single `src/utils/canvasViewport.ts` helper. Two deliberate
  consequences: the former `- 480` fallback sites fall back to plain window size
  when no canvas is mounted, and **click-placed nodes now center on the canvas
  (matching paste), not the window.**

### Removed
- **Dead code (arch-08).** Deleted the unused `useCanvasSelectionData` hook (225
  lines that duplicated `PixiCanvas`'s inline memos) and the unused
  `SegmentedControl` control from `PropertyInputs.tsx`.

## [0.48.0] - 2026-07-18

### Changed
- **Properties panel no longer recomputes Yoga on unrelated drags (perf-02).**
  `SizeSection` and `SelectionColorsSection` subscribed to the whole
  `nodesById` / `childrenById` maps, which get a fresh reference on every scene
  mutation, so both always-mounted sections re-rendered — and re-ran the Yoga
  layout (`calculateFrameIntrinsicSize` / `calculateLayoutForFrame`) in their
  render path — on every frame of a drag of *any* node (60–120 Hz). They now
  subscribe (via `useShallow`) only to the node references inside the relevant
  subtree (a new `collectSubtreeIds` helper) and read the maps via `getState()`
  at point of use, so Yoga runs for the selected node only when that node's own
  subtree actually changes. (This finishes the isolation `perf-01` started; the
  displayed values are unchanged.)
- **Tool hotkeys derive from a single source (arch-04).** The plain-letter tool
  dispatch in `keyboardCommands.ts` — 14 hand-written `if (e.code === …)` blocks
  — is now generated from `toolDefinitions` (`ALL_TOOLS`), so the shortcut shown
  in the toolbar, command palette, and README can no longer drift from the one
  that fires.

### Fixed
- **Corrected drifted tool-shortcut labels (arch-04).** The toolbar and command
  palette advertised **Connector = `C`**, but `C` became comment mode in cmt-01
  — the connector actually lives on **`N`**; and **Text on Path = `⇧T`** was a
  phantom (no handler ever existed). Labels fixed and the README shortcut tables
  brought up to date (Connector `N`, Comment `C`, `⇧D`/`⇧M`/`⇧C`/`⌘⇧O`/`⌘⇧[`/`]`).

### Internal
- **Extracted a shared `EditableText` inline-edit component (arch-05).** Five
  drifted copies of the same click-to-edit field (`VariablesPanel`,
  `TextStylesPanel`, `StylesPanel`, `PagesPanel`, `LeftSidebar`) collapsed into
  one `src/components/ui/EditableText.tsx`. Each call site's behavior is
  preserved via props (`allowEmpty`, `activateOn`, `onEditingChange`), so any
  future UX fix (IME, select-all timing, click-outside) is a one-place change.

## [0.47.0] - 2026-07-18

### Fixed
- **Multi-select edits now go through a sceneStore action (arch-01).**
  `MultiSelectPropertyEditor` was the only production component writing to the
  scene store via a hand-rolled `useSceneStore.setState`, re-implementing
  `updateMultipleNodes` but silently dropping two contract steps:
  `syncTextDimensions` (multi-selecting text nodes and changing a sizing mode
  left stale measured dimensions) and `markComponentArtifactsStaleFromNative`
  (editing a reusable component frame via multi-select left its HTML export
  artifact marked `in_sync` while the native node changed). Both blocks now call
  a new `updateMultipleNodesMerged` action that replicates the full mutation
  contract (history, text re-measure, artifact stale-marking, dirty-tracking)
  while keeping the per-node deep merge for `sizing`/`layout`.
- **3D-layer toggle now tracks reparents (arch-02).** `Layers3DToggle`'s
  `disabled` state resolved its target frame from untracked `getState()` reads
  and subscriptions that didn't cover `parentById`, so moving a selected node to
  a different frame could leave the button's enabled/disabled state stale.
  `resolveTargetFrame` is now a pure function subscribed via a selector.

### Changed
- **Narrowed the last whole-store subscriptions (arch-02, perf).** `PixiCanvas`
  (the heaviest component) subscribed wholesale to the clipboard, selection,
  history, and drawMode stores — `drawModeStore`/`historyStore` churn at pointer
  rate, so the whole canvas subtree re-rendered on every pointermove while
  drawing and every undoable edit. These, plus `PrimitivesPanel`, the inline
  name/text editors, and `useNodePlacement`, now use per-field selectors (or
  imperative `getState()` reads inside click handlers). Also removed a dead
  `copiedNodes` param that forced 9 window listeners to re-register on every copy.
- **Toolbar File menu delegates to `fileCommands` (arch-03).** The File menu
  re-implemented `exportAsJson`/`exportAsPen`/`openDocument` statement-for-
  statement (including the 8-field `pagesForExport` mapping) and subscribed to
  the variables/text-styles/fill-styles/effect-styles stores *only* to feed
  those handlers — re-rendering the whole ~100-line menu tree on every keystroke
  in those panels. It now calls the shared `fileCommands` functions and drops
  the four handler-only subscriptions.

## [0.46.1] - 2026-07-18

### Fixed
- **Rotation field is now a real `NumberInput` (bug-14).** The Rotation input in
  the Position section was a hand-rolled control that committed to the store on
  every keystroke — one undo entry per character — and ignored `useReadOnly()`,
  so it stayed editable inside the Dev Mode Inspect panel's read-only wrapper. It
  now routes through the shared `NumberInput`, inheriting the draft layer, the
  single-undo-batch-per-edit behavior, min/max clamp, and the read-only guard —
  matching the X/Y fields. (`NumberInput` gained an icon-only rendering branch.)
- **Convert-to-design no longer silently drops inline SVG icons (bug-15).**
  `convertSvg` passed captured `<svg>` markup straight to a `data:` URL. Markup
  without an explicit `width`/`height`/`viewBox` (typical Feather/Lucide icons)
  decoded to 0×0 and rendered as nothing, even though a node existed in the tree.
  A new pure `normalizeSvgMarkup` injects the missing dimensions before encoding,
  and an empty-content `<svg>` now gets a visible gray placeholder instead of an
  invisible empty frame.
- **SVG `data:` image fills without intrinsic size now render (bug-16).** The
  Pixi image-fill loader rejected any image that decoded to natural size 0×0, so
  a dimensionless SVG data-URI drew nothing regardless of its source (converter,
  AI tool, manual paste). The loader now normalizes SVG markup as a last barrier
  (reusing bug-15's `normalizeSvgMarkup`) and tolerates a 0×0 natural size for
  SVG sources, rasterizing to the node's target size. The raster-image path is
  unchanged — genuinely broken images still fail.

## [0.45.1] - 2026-07-17

### Fixed
- **Panel edits reach the canvas live again.** 0.45.0's `NumberInput` draft layer
  only pushed a value to the store on blur/Enter, so the canvas stopped tracking
  typing — wrong for a visual editor, where every change belongs on screen
  immediately. Every parseable keystroke commits again; the draft survives purely
  as the field's text buffer, so intermediate strings (`""`, `"-"`) still never
  reach the scene.

  The undo spam that motivated the draft layer is handled the way `useScrubLabel`
  already handles a drag: snapshot + `startBatch()` at the first commit,
  `endBatch()` at the end. A focus→blur session is therefore **one** undo step —
  better than 0.45.0's predecessor, which recorded one per keystroke.
- **History no longer dies silently after Escape in a panel field.** The editing
  batch now closes when the input unmounts. Escape is handled by a window keydown
  listener registered with `{ capture: true }` (`useCanvasKeyboardShortcuts`),
  which clears the selection and unmounts the field before its own keydown/blur
  handlers can run; the open batch outlived the component and left `batchDepth`
  above 0, which suppresses **all** history recording for the rest of the session
  (undo/redo quietly stops working, with nothing in the console).

### Removed
- `NumberInput`'s Escape-revert (added in 0.45.0). The capture-phase listener
  above unmounts the field before the component's own Escape handler can run, so
  the revert was unreachable in the properties panel. Escape now keeps the typed
  value, as it did before 0.45.0. Making revert work would mean gating the
  `Escape` branch in `keyboardCommands.ts` on `isTyping`, the way the neighbouring
  arrow-key branch already is.

## [0.45.0] - 2026-07-17

### Changed
- **Properties panel render isolation (perf-01).** `PropertiesPanel` no longer
  subscribes to the whole scene tree (`getNodes()`) or to the entire selection
  store. It now subscribes narrowly — to the selection and to the *selected node*
  via the flat `nodesById` map — so a mutation of an unrelated node no longer
  invalidates the tree cache, rebuilds the tree O(N), and re-renders every mounted
  section. Sections receive flat nodes and materialize subtrees via
  `materializeLayoutRefs` where they need children; the broad tree subscriptions
  survive only in the rare multi-select and instance-descendant branches, or are
  read imperatively at event time. `PropertyEditor` is `React.memo`-wrapped with
  stable props, and the component lookup for instances is now O(1).

  Scope note: the isolation is **partial by design**. `SizeSection` and
  `SelectionColorsSection` still subscribe to the flat maps, which get a fresh
  reference on every mutation, so they still re-render (and still run Yoga in
  render) during drag. Removing Yoga from the render path was an explicit non-goal
  here and is tracked as follow-up perf-02.

### Fixed
- **Number inputs no longer write to the store on every keystroke.** The shared
  `NumberInput` gained a local draft layer: typing edits only local state, and the
  store is committed exactly once on blur/Enter, with Escape reverting. Typing
  "250" previously produced three store writes and **three undo entries**, and
  pushed the intermediate values (2, 25) onto the canvas, retriggering auto-layout
  each time. It is now one undo entry for the whole edit, and nothing reaches the
  canvas until commit. Values are clamped to min/max on commit; label scrubbing is
  unchanged. Read-only fields (Dev Mode's inspect panel) correctly commit nothing.
- **Multi-select fit-content no longer risks showing/writing one node's size for
  the whole selection.** The merged multi-select node borrows the first selected
  node's id, so the fit_content branches are now explicitly gated on
  `isMultiSelect` rather than relying on the absence of a `children` array.

## [0.44.0] - 2026-07-16

### Added
- **Agent-authored comments (cmt-02).** The design agent can now leave its own
  comment pins via the `leave_comment` tool (schema in backend 0.16.0) — the
  reverse of cmt-01's loop, turning the agent into a reviewer. Each pin is
  anchored to the flagged node, so a finding points at the exact element instead
  of getting lost in a wall of chat text. Agent pins are visually distinct
  (violet with a sparkle glyph vs. blue user pins) and tagged "Agent" in the
  Comments panel. The tool takes a batch of findings in one call and reports the
  created thread numbers. Pair it with the `/design-review` skill: "review this
  screen" → the agent checks contrast/typography/spacing/consistency against the
  guidelines and drops a pin on each issue. Agent comments stay outside
  undo/redo like all others.

## [0.43.0] - 2026-07-16

### Added
- **Canvas comments + AI-agent loop (cmt-01).** Figma-like commenting: press
  **C** for comment mode, click to drop a pin — anchored to a node (it tracks
  the node through move/resize/auto-layout) or to a bare canvas point. Threads
  support replies, edit/delete your own message, resolve/unresolve, and
  delete-with-confirmation. A **Comments** tab in the left rail lists every
  thread with navigate-to-pin (across pages), "Show resolved" and "Current page
  only" filters, and an "unattached" badge for threads whose anchor node was
  deleted. **Shift+C** hides pins.
  - Comments live **outside undo/redo** — a design Cmd+Z never resurrects a
    deleted thread or erases a new one. Deleting an anchor node doesn't touch
    the comment; the pin just hides until undo brings the node back.
  - Comments round-trip in `.pen` per page (omitted when empty; legacy files
    load cleanly).
  - The pin gives the AI agent an exact node anchor that plain chat lacks.
    "Send to agent" seeds a chat about comment #N and opens the agents panel;
    three client-executed tools — `read_comments`, `reply_comment`,
    `resolve_comment` (schemas in backend 0.15.0) — let the agent read and act
    on threads.
- The connector tool's keyboard shortcut moved from **C** to **N** (it has no
  toolbar button; C is now comment mode).

## [0.42.0] - 2026-07-16

### Added
- **Export from Dev Mode.** The Inspect panel now has an Export section, so a
  developer can grab an asset (icon as SVG, image at 2x, …) without leaving Dev
  Mode for Design mode — the same list of format/scale rows, suffixes, presets,
  and "Export all" available in Design mode. Because Dev Mode is read-only, the
  settings are ephemeral session-only overrides keyed by node: they never touch
  `node.exportSettings` or the `.pen` document (someone who "just looked" never
  produces a diff) and reset when Dev Mode is exited. A node the designer
  already configured shows those settings as its starting point; an unconfigured
  node offers one default PNG 1x row so a single click exports.

## [0.41.0] - 2026-07-15

### Fixed
- **Holes in Figma compound vectors.** Pasting a compound vector from Figma
  filled in its holes. PixiJS 8 only discovers compound-path holes for `evenodd`
  fills, but Figma's decoded geometry uses SVG's `nonzero` rule, so each subpath
  rendered as a solid shape. The path renderer now derives the fill boundaries
  itself — from where the accumulated winding crosses between zero and non-zero
  — which also preserves same-winding nested contours. Holes survive across
  disjoint subpaths as well, such as the two-person icon where each figure
  carries its own hole. Geometry containing a relative `m` subpath keeps Pixi's
  native fallback, since such a subpath depends on the previous one's endpoint.
- **Auto-layout hit-test z-order.** In an auto-layout frame, an
  absolute-positioned child was hit-tested as if it were topmost, so it could
  swallow clicks meant for a regular child drawn above it. `prepareFrameNode`
  had been appending absolute-positioned children to the computed flow children,
  which both duplicated them and put them last; the layout store already applies
  computed geometry in place over `frame.children`, preserving each child's
  original z-order.

## [0.40.0] - 2026-07-15

### Added
- **Gradient and multiple strokes (p1-22).** Strokes are now a paint stack
  (`strokes: Paint[]`) just like fills: solid and gradient (linear/radial)
  paints, several strokes composited bottom-to-top in one geometry, each with
  its own `visible`/`opacity`/`blendMode`. Stroke geometry (weight, align,
  per-side widths) stays a single node-level property, matching Figma's model —
  two stroke paints cannot have different weights. The Stroke panel gained the
  same add/remove/reorder/blend controls as Fill, opening the existing gradient
  editor. Legacy single-color strokes keep working and migrate into the stack
  on first edit; old `.pen` files open unchanged.
- **Text on a path (p2-11).** New text-on-path tool: click a vector path and it
  becomes a text node whose glyphs run along the curve, rotated to the tangent
  (the path's fill and effects move onto the text; no leftover path node). A
  draggable on-canvas handle sets the start point, and `side`/`flip` put the
  text above or below the line and reverse its reading direction. The curve
  stays editable through the existing path point-edit mode, with the text
  re-flowing live. Text past the end of the path is clipped, matching the SVG
  `<textPath>` spec, with an overflow indicator in the panel. Built on a new
  arc-length module (`pathMeasure`) — the first such arithmetic in the editor.

### Changed
- Pasting from Figma now preserves gradient and multiple strokes 1:1 (stops,
  angles, per-paint opacity, weight, align, per-side widths). Previously every
  stroke but the topmost was dropped and a gradient stroke silently degraded to
  its first stop's color.
- The AI agent can set the stroke stack via `batch_design`'s `strokes`.
- Dev Mode, `.pen` export, style copy/paste, PPTX and SVG/HTML export all read
  the stroke stack instead of the legacy single-color field, so a gradient
  stroke no longer disappears from them.
- SVG export renders gradient strokes as `stroke="url(#...)"` and composites a
  multi-paint stroke stack in full. CSS export uses `border-image-source` with
  `border-image-slice: 1` — Figma's own Copy as CSS omits the slice, which
  renders nothing at all; the `border-radius` incompatibility is inherent to
  CSS border-image and is documented in code.
- Text on a path is exported natively to SVG via `<defs><path>` + `<textPath>`.
  HTML/PPTX degrade to straight text (no CSS equivalent exists); PDF keeps full
  fidelity since it rasterizes the canvas.

## [0.39.0] - 2026-07-15

### Added
- **Dev Mode code generation (dev-02).** The Inspect panel's Code tab now
  generates real code for the selected node with a format dropdown — **CSS**,
  **Tailwind**, or **React (JSX)** (with an inline-styles ↔ Tailwind-classes
  sub-toggle) — remembered in localStorage. Output reuses the same
  node→CSS-declarations layer as HTML export and Copy as CSS, honors the
  px/rem unit switch, and resolves bound variables to `var(--token)` with the
  `:root` token definitions shipped alongside (CSS block, HTML/JSX comment, or
  a warning for bare class strings). Tailwind maps exact standard-scale values
  to utilities and falls back to arbitrary values; React output is a
  compilable function component (verified by a TypeScript transpile check in
  tests). Includes a dependency-free syntax highlighter with dedicated
  theme-aware `--color-code-*` tokens, copy button, and collapsing for long
  code (40+ lines).

### Fixed
- Codegen review fixes: px→rem conversion is scoped to declaration values (no
  longer rewrites selectors, comments, or variable names containing
  px-shaped substrings); React `className` output is quote-safe (pattern-fill
  URLs can no longer break the JSX); unsupported nodes (component instances,
  embeds, vector shapes, video fills) now emit explicit warnings instead of
  silently rendering as empty `<div>`s; multi-selection shows a "first of N"
  hint in Tailwind/React formats.

## [0.38.0] - 2026-07-15

### Added
- **Dev Mode (Figma-style developer handoff — free).** Toggle with the `</>`
  button next to Play or `Shift+D`. The canvas becomes read-only (selection,
  pan and zoom keep working; drag/resize/draw/text-edit and mutating shortcuts
  are blocked, including command-palette edit commands), and the right panel
  is replaced by an **Inspect** panel: box-model diagram, layout, typography,
  fills/strokes/effects/radius with bound variable and shared-style names
  (tokens expand to their light/dark values), everything copy-on-click, plus a
  Code ↔ List toggle (code generation lands in dev-02) and a px/rem unit
  switch (rem base 16, remembered in localStorage). Variable colors resolve
  through the node's effective theme (ancestor `themeOverride` respected), so
  copied values match the canvas.
- **Hover measurements.** In Dev Mode, hovering another node draws the red
  distance overlays without holding Alt (Alt+hover in normal mode unchanged);
  labels honor the px/rem unit choice.
- **Measurement tool (`Shift+M`).** Drag from node to node to pin a persistent
  measurement, rendered only in Dev Mode. Measurements are saved per page into
  the document, participate in undo/redo, survive save/load, are cleaned up
  when the anchored nodes are deleted (including boolean ops, embed/frame
  conversions, instance detach and AI batch edits), and can be selected and
  removed with Delete. Undo/redo (Cmd+Z) works inside Dev Mode.

## [0.37.0] - 2026-07-14

### Added
- **Export page can produce images, not just a PDF.** The Export page section
  gains a format selector — PNG, JPG, WebP or PDF (SVG stays per-node in export
  settings). PDF is unchanged: every top-level frame becomes a page of one
  multi-page PDF, in Layers order. Pick a raster format and each frame is
  rasterized separately and downloaded as a single ZIP, one image per frame.
  The 1x/2x/3x scale applies to both. Frames that share a name are deduplicated
  (`Slide_1.png`, `Slide_1-2.png`) so nothing is silently dropped, and the
  status line reports how many files actually landed in the archive.

### Fixed
- **JPG export no longer turns transparent areas black.** The canvas is
  flattened onto white before JPEG encoding (JPEG has no alpha channel); PNG
  and WebP keep transparency.

### Changed
- Raster page export no longer loads the PDF library. The frame helpers shared
  by every exporter moved out of `exportPdfUtils` into `exportUtils`, so
  `pdf-lib` (a 422KB chunk) is fetched only when you actually export a PDF.
  The three near-identical Pixi extract-to-bytes copies in the PDF, PPTX and
  ZIP exporters collapsed into one shared `extractImageBytes`.

## [0.36.0] - 2026-07-14

### Changed
- **Play mode is a real presentation view, not a zoom on the canvas.** Entering
  Play now shows only the active slide — every other top-level frame and root
  node is hidden (derived on every resync, so a background resync can't reveal
  them), and nodes you hid in the Layers panel stay hidden when you exit. The
  canvas backdrop swaps to a dark, theme-independent
  `--color-present-background` (scene data is untouched — `pageBackground` is
  never mutated). The controls pill fades out after ~3s without mouse movement
  and returns on the next move, staying visible while you hover it.
- **Slides fit to the width of the screen.** New `viewportStore.fitToWidth`
  scales the active frame to the viewport width with no padding: short slides
  centre vertically, tall slides align to the top so they start at the
  beginning. A slide taller than the screen scrolls down with the
  wheel/trackpad, clamped to its own top and bottom edges — only `viewport.y`
  moves, so zoom, horizontal pan and node editing stay locked in Play. Arrow
  keys and Space still navigate between slides; touch drag remains blocked.
  `fitToContent` is unchanged, so `viewCommands` and `PageControls` behave
  exactly as before.

## [0.35.0] - 2026-07-14

### Changed
- **Convert to design now uses the h2d capture pipeline.** `convertEmbedToDesign`
  renders the embed's HTML in a sanitized same-origin iframe, captures the
  browser-computed layout with a vendored DOM-capture bundle
  (`src/vendor/h2dCapture/`, refresh via `scripts/update-h2d-capture.sh`), and
  converts it through the same `h2dToScene` converter used for clipboard paste.
  Converted slides are now geometrically faithful to the embed render (measured
  rects instead of re-inferred layout). The legacy DOM-walk importer
  (`convertHtmlToDesignNodes`) remains as the shared CSS-parsing library.
  Conversion failures now surface as a toast; the capture iframe has a 10s load
  timeout and a guard against the embed being deleted mid-conversion.

### Fixed
- **Cyrillic (and other missing-glyph) text no longer falls back to serif after
  conversion.** Text nodes keep the CSS stack's generic fallback in a new
  `fontFallback` field, applied in the Pixi renderer, text measurement, and the
  inline text editor — latin-only families like Plus Jakarta Sans now degrade to
  the correct generic instead of the browser default.
- **JetBrains Mono loads after conversion/paste** — it was missing from the
  Google-fonts registry, so nodes using it silently rendered in a fallback font.
- **Gradient-only elements survive h2d conversion/paste in more cases:**
  `repeating-linear-gradient` approximates as a linear gradient, radial gradients
  convert properly, unsupported gradient functions (conic) degrade to the first
  stop color, and multi-layer `url(...), gradient(...)` backgrounds keep the
  first-layer image instead of dropping it.

## [0.34.0] - 2026-07-14

### Added
- **DTCG design-tokens export/import.** New File-menu actions (and command-palette
  entries) **Export design tokens (.tokens.json)** and **Import design tokens…**
  bridge the editor's variables and fill/effect/text styles to the
  [Design Tokens Community Group](https://tr.designtokens.org/format/) JSON format,
  so tokens can flow through Style Dictionary and other DTCG tooling.
  - Variables map to `color`/`number` tokens (light value in `$value`, dark theme
    in `$extensions`); string variables emit without a `$type`.
  - Fill styles map to `color` (solid, with variable bindings serialized as
    `{alias}` references) or `gradient` tokens; effect-style shadows map to
    `shadow`; text styles map to `typography`.
  - Round-trip identity is preserved via `$extensions["com.peneditor"]` (original
    store id + source), so re-importing an exported file updates entities in place
    rather than duplicating them. Foreign DTCG files import via a `$type` heuristic.
  - Import merges into the stores as a single undo step. Name collisions,
    unsupported fills (image/pattern/video), blur effects, and non-numeric values
    surface as toast warnings.

### Added
- **Slides creation** — the Slides section now has a persistent divider,
  section header, and `+` action that creates and selects a new 16:9 frame.
- **Slides document header** — Slides restores the File menu and editable
  document name alongside the Pages experience.

### Fixed
- **Slide previews** — standardized preview proportions, spacing, numbering,
  hover/selection styling, and thumbnail extraction updates.

## [0.24.1] - 2026-07-11

### Fixed
- **3D layer view: planes were invisible.** Tailwind preflight's
  `img { max-width: 100% }` resolved against the absolutely-positioned (zero-width)
  stack and collapsed every snapshot plane to 0px wide. Planes now opt out with
  `max-width/height: none`. (Only reproducible in the real browser with Tailwind
  loaded — added a regression test.)
- **3D layer view: control bar was unreachable.** The bottom draw-tool palette
  (and rulers) stayed mounted over the 3D view and covered the spacing/reset/exit
  control bar. Both are now hidden while the read-only 3D view is active.

## [0.24.0] - 2026-07-11

A read-only **3D layer view** for inspecting how a frame's layers stack.

### Added
- **3D layer view** — a floating "3D" toggle (top-center of the canvas)
  explodes the selected frame's subtree into perspective-stacked planes, one
  per node in paint order. Each plane is a real Pixi snapshot
  (`renderer.extract`) of that node, so layers look exactly like the design.
  Drag to orbit, scroll to zoom, hover to highlight a layer, and a spacing
  slider controls the gap between planes; "Reset view" and Esc/"Exit" return
  to the 2D canvas. The view is read-only and does not mutate the scene — the
  Pixi canvas is hidden (never unmounted) underneath while it is active.
  New `layers3dStore`, `captureLayers` snapshot pipeline, `resolveTargetFrame`
  selection logic, and `Layers3DOverlay`/`Layers3DToggle` components.

## [0.11.0] - 2026-07-07

Fourth gap-closing batch versus Figma: richer vector shapes, pattern fills,
layer masks, and text lists.

### Added
- **Shapes: stars, ellipse arcs, arrowheads** — polygons gain a star mode
  (`innerRadiusRatio` + point count) with a toolbar Star tool; ellipses gain
  arc/donut parameters (`startAngle`/`sweepAngle`/`innerRadiusRatio`, one
  shared geometry module for Pixi and SVG export); lines gain start/end caps
  (arrow, triangle, circle, bar) rendered in Pixi and exported as SVG
  `<marker>` defs. All editable in the properties panel and creatable via
  `batch_design`.
- **Pattern fills** — a repeating image-tile paint type with scale, spacing,
  and row-offset (stagger), coexisting with the rest of the paint stack and
  blend modes on rectangles, frames, and ellipses. Baked pattern cells are
  LRU-cached; SVG tiles load at natural size; the fill editor gets a shared
  upload control.
- **Layer masks** — Figma-style `isMask`: a node masks the siblings above it
  in the same group/frame (vector masks via Graphics; per-pixel alpha masks
  for image-fill maskers), with LayersPanel indication, hidden-mask
  semantics, mask-aware hit-testing, and clip-path/mask-image parity in HTML
  export plus native `<mask>` in SVG export.
- **Text lists** — bullet and numbered lists with per-paragraph attributes
  (`paragraphs`: list type + indent level), inline editing (Enter continues
  or outdents, Tab/Shift+Tab change level on list paragraphs), Cmd+Shift+8/7
  hotkeys, hanging indents, list-aware wrap/measure/auto-size, nested
  `<ul>`/`<ol>` HTML export, and AI support via `batch_design`.

### Fixed
- Copy/paste style now transfers arrowheads, star ratio, and ellipse arc
  parameters; width/height edits keep stars star-shaped; line cap tips are
  hit-testable; the root SVG export no longer clips overflowing caps.
- Nested `clip: true` frames keep their clipping (regression caught in
  review of the mask feature); toggling `isMask` on root-level nodes takes
  effect immediately.
- Native text edits (paste, backspace line-merge, cut) and AI text updates
  keep paragraph list attributes aligned with the text; Enter deletes a
  non-collapsed selection; Tab no longer writes hidden state on plain text;
  center/right alignment is honored in list rendering.

### Performance
- Pattern sprites resize in place instead of destroy+rebake per resize tick.
- Sibling-mask resolution early-exits for mask-free scenes (was O(N²) per
  structural sync); mask dirty-tracking iterates the dirty set, not the tree.
- List text nodes skip the full Pixi rebuild on position-only updates.

## [0.10.0] - 2026-07-06

Third gap-closing batch versus Figma: typography system, flexible layouts, and
squircle corners.

### Added
- **Text styles** — named reusable text styles (family, size, weight,
  line-height, letter-spacing, transform): create from a selected text node,
  apply from the Typography section, edit centrally with propagation to every
  bound node, local override and detach (tracked via `textStyleId` +
  `textStyleOverrides`). New Text styles panel, `.pen` serialization, and
  three AI tools: `get_text_styles`, `set_text_styles`, `apply_text_style`.
- **Auto-layout wrap & min/max** — flex wrap with independent row/column gaps
  and per-child `minWidth`/`maxWidth`/`minHeight`/`maxHeight` clamps, wired
  through the layout engine, properties panel, `batch_design`, HTML
  conversion in both directions, and public `.pen` export.
- **Corner smoothing (squircle)** — Figma-formula corner smoothing (0–100%,
  60% ≈ iOS) on rectangles and frames, composing with per-corner radii; one
  shared contour implementation drives both Pixi rendering and SVG export.
- Drawing tool variants are now grouped in the toolbar.

### Changed
- The flex layout engine resolves flexible lengths iteratively per the CSS
  spec (freeze min/max violators, redistribute), so clamped children no
  longer overflow or under-fill their container; line wrapping uses clamped
  hypothetical sizes; stretch children fill the line even in hug-sized
  containers.
- History batching is reference-counted (`batchDepth`), so nested batch
  scopes compose — one AI tool call is always one undo step.
- PWA update prompt migrated to a styled sonner toast.

### Fixed
- Vector point-edit anchors no longer drift from the path shape.
- Editing a text style, deleting it, or undoing either now keeps the style
  collection and bound nodes consistent (styles are part of history
  snapshots); partial AI style updates no longer rename styles to
  "Untitled"; multi-style AI calls no longer create duplicates.
- Row-gap-only auto-layout frames survive public `.pen` export; disabling
  wrap migrates the per-axis gap back into the single gap field so the Gap
  control keeps working; interactive resize respects min/max clamps live
  instead of popping back after commit.
- Copy/paste styles transfers corner smoothing; shader-filled nodes re-bake
  their clip mask when corner geometry changes.

## [0.9.0] - 2026-07-05

Second gap-closing batch versus Figma: effects, workflow, components, AI image
editing, and full vector editing.

### Added
- **Inner shadows** — new `shadowType: "inner"` effect in the effects stack
  (x/y/blur/spread/color, multiple per node, coexists with drop shadow),
  rendered in Pixi via an inverted-alpha cutout composition; maps to
  `box-shadow: inset` in designToHtml and is settable through `batch_design`.
- **Copy/paste properties** — Cmd+Opt+C / Cmd+Opt+V (and Edit-menu items)
  transfer fills, strokes, effects, corner radius, opacity, blend mode, and
  typography between nodes, Figma-style: type-aware filtering (text styles
  never land on shapes; ref instances receive only rendered fields),
  multi-selection paste, single-step undo, and legacy↔paint-stack
  normalization so a paste always wins over stale representations.
- **Component variants & properties** — reusable components (`frame` +
  `reusable`) can declare variant/boolean/text properties bound to descendant
  fields; instances switch them from a new properties-panel section (select /
  toggle / text input) independently of manual overrides. The AI agent can
  declare and switch properties through `batch_design`, with full validation
  on the tool path; AI-facing docs corrected to the real frame/ref component
  model.
- **AI Remove Background** — one click on an image fill (or the new
  `remove_background` AI tool) cuts the subject out using BriaAI RMBG-1.4
  running entirely in the browser via onnxruntime-web: nothing is uploaded,
  the ML runtime and model are lazy-loaded on first use (excluded from the
  PWA precache), and the result replaces the fill as a PNG with alpha,
  preserving fit mode. Verified end-to-end in a live browser.
- **Pen tool & path editing** — press P to place corner anchors (click) and
  smooth anchors with symmetric Bézier handles (drag); click the first anchor
  to close, Esc/Enter to finish. Double-click or Enter on any path — including
  legacy pencil strokes, which migrate lazily — opens point editing with
  draggable anchors/handles, Alt to break handle symmetry, and correct
  undo/redo. Polygon tool hotkey moved from P to G.

### Fixed
- Style paste onto component instances no longer silently writes fields the
  instance renderer ignores; path→path style paste carries `pathStroke`; the
  style clipboard deep-copies snapshots instead of sharing live arrays.

P0 gap-closing batch versus Figma: vector, export, layout, and precision tooling.

### Added
- **Boolean operations** — Union / Subtract / Intersect / Exclude / Flatten for
  rect/ellipse/polygon/path via `martinez-polygon-clipping`; destructive result
  is a single path node with undo support. Exposed through a Properties Panel
  section, hotkeys (Cmd/Ctrl+Alt+U/S/I/X/E), and a new client-executed
  `boolean_operation` AI tool.
- **SVG export** — scene-graph → SVG serializer (shapes as native primitives,
  linear/radial gradients, drop shadow, layer blur, stroke-align emulation);
  embed/shader/ref nodes degrade to a placeholder with a warning. New "SVG"
  option in the Export panel.
- **Layout constraints** — per-child min/max/center/stretch/scale on each axis;
  children recompute when a non-auto-layout frame is resized. Constraints
  section (cross widget + H/V selects) and `batch_design` support for the AI.
- **Rulers & guides** — toggleable rulers (Shift+R) with zoom-aware labels and
  persistent draggable guides that objects snap to; guides round-trip through
  `.pen`.
- **Per-corner radius via AI** — `batch_design` accepts `cornerRadius` as a
  number or `[tl, tr, br, bl]` array (CSS-shorthand aware).

### Note
- Changelog gap: releases 0.6.0 (layer blur) and 0.7.0/0.7.1 (PWA) shipped but
  were not logged here at the time.

## [0.5.0] - 2026-07-03

Multi-fill (Figma-style paint stack) parity: paint stacks now survive the full
node lifecycle — paste from Figma, edit, clone, export, and AI serialization.

### Added
- **Paint stack in public `.pen` export** — nodes with 2+ visible fills export a
  `fills` array (bottom-to-top); single-fill nodes keep the scalar `fill` shape.
- **Paint stack in path/polygon SVG export** — stacked shape elements with
  `<defs>` gradients; stroke emitted once on the topmost layer.
- **Per-fill opacity control** — percent input in the fill popover, for all
  paint types (model stores 0–1; Figma-pasted layer opacity is now editable).

### Fixed
- Converting a reusable frame to a component instance (`ref`) no longer drops
  the frame's `fills` and `effects` stacks.
- AI state serialization resolves per-paint `colorBinding` variables inside
  `fills[]` (previously only the legacy `fillBinding` was resolved).
- Legacy `gradientFill`/`imageFill` nodes with `fillOpacity` keep their opacity
  in public `.pen` export.

## [0.4.0] - 2026-07-03

First tracked release. Summarizes the features shipped up to this point.

### Added
- **AI image generation** — `generate_image` and `generate_frame_image` client
  handlers; data:image URLs render inline in chat; "Generate image" quick action.
- **Shader nodes** — curated shader registry + prop builder, a `ShaderConfig` on
  any node, and a properties-panel Shader section with presets and param controls.
  Shaders render **inside Pixi**, baked to a texture so they respect scene z-order.
- **Agent-on-canvas for embeds** — on-canvas agent affordance for selected embed
  nodes (`EmbedAgentButton`), selection-only (no screenshot).
- **Figma-style selection navigation** — one-level drill on double-click with
  scope-chain hit testing; Tab / Shift+Tab move selection between sibling nodes.
- **View mode** — disables node hover highlight and clears selection.

### Changed
- Shaders migrated from a DOM overlay (`ShaderLayer`) to Pixi-baked textures, so a
  shader node can sit under/between other nodes.
- Refactored on-canvas agent code: shared `launchNodeAgentChat` core and a
  generic `NodeAgentButton` (frame button became a thin wrapper).

### Fixed
- Various shader polish: propagate shader on clone/export, gate image filters,
  robust clipping, guard unknown shader kinds, hide overlay for hidden ancestors.
- Align inline frame-name editor with the canvas label position.
- Remove double-shaded blue on the selected layer row.

[Unreleased]: https://github.com/dan-rozhkov/pen-editor/compare/v0.30.0...HEAD
[0.30.0]: https://github.com/dan-rozhkov/pen-editor/compare/v0.29.0...v0.30.0
[0.11.0]: https://github.com/dan-rozhkov/pen-editor/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/dan-rozhkov/pen-editor/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/dan-rozhkov/pen-editor/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/dan-rozhkov/pen-editor/compare/v0.5.0...v0.8.0
[0.5.0]: https://github.com/dan-rozhkov/pen-editor/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/dan-rozhkov/pen-editor/releases/tag/v0.4.0
