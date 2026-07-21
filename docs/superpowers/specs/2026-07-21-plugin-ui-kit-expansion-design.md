# Plugin UI-kit expansion — give the design agent all app-analog UI elements

**Date:** 2026-07-21
**Repos:** `pen-editor` (frontend) + `pen-editor-backend` (skill)

## Problem

When the design agent authors a generative plugin (`create_plugin`/`update_plugin`,
guided by the backend `plugin` skill), the only editor-matching UI primitives it can
reach are **9** `.pen-*` classes baked into `PLUGIN_UI_KIT_STYLES`
(`pen-editor/src/lib/plugins/uiKitStyles.ts`): `button`, `button-primary`, `input`,
`textarea`, `select`, `label`, `checkbox`, `row`, `stack`.

The app itself (`pen-editor/src/components/ui/`) uses many more primitives — badge,
card, separator, slider, tabs, inline-alert, table, field, icon button, button group,
input group, and text helpers. A plugin that wants any of these has to hand-roll CSS
that drifts from the editor's look and doesn't follow live theme switches. The goal:
**expand the UI kit so the agent has a `.pen-*` analog for every app primitive that
can be faithfully reproduced in a sandboxed, static plugin iframe.**

## Scope & feasibility boundary

The plugin iframe is `sandbox="allow-scripts"` with a null origin and **no framework
bundled** — plain DOM/CSS only. Primitives that are pure presentation (or thin wrappers
over native controls) can be offered as `.pen-*` classes. Primitives that fundamentally
need React + Radix portals, floating/positioned overlays, or complex interaction
(dropdown-menu, context-menu, popover, dialog, alert-dialog, combobox, command palette,
ColorPicker, GradientBar, FontCombobox, tooltip, sonner toasts) are **out of scope** —
a plugin builds those itself with plain DOM if needed, and `pen.notify` already covers
toasts. This is the sensible reading of "all available UI elements": all that a static
sandbox can render 1:1.

## New `.pen-*` classes

All classes reference **only** tokens already in `THEME_CSS_VARS`
(`bootstrap.ts`) — no new theme variable, no `src/index.css` change, so the
`uiKitStyles.test.ts` var-guard stays green.

| Class | App analog (`ui/`) | Recipe (existing tokens) |
|---|---|---|
| `.pen-badge` | `badge.tsx` | pill: `secondary` bg / `secondary-foreground`, `border-default`, radius-full, 11px |
| `.pen-card` | `card.tsx` | `surface-elevated` bg, `border-default`, radius-8, padding |
| `.pen-separator` | `separator.tsx` | 1px `border-default` horizontal rule |
| `.pen-slider` | `slider.tsx` | native `<input type=range>`, `accent-color: accent-primary` |
| `.pen-tabs` + `.pen-tab` | `tabs.tsx` | `secondary` track; active tab (`[aria-selected="true"]`/`.pen-tab-active`) → `surface-panel` bg + `text-primary`; inactive → `text-secondary` |
| `.pen-alert` | `inline-alert.tsx` | `surface-panel` bg, `border-default`, `text-primary`, radius-6 |
| `.pen-table` | `table.tsx` | full-width; `th`/`td` via descendants, `border-light` row borders, muted header |
| `.pen-field` | `field.tsx` | vertical group (label + control + help), gap |
| `.pen-help` | `FieldDescription` | `text-muted`, 11px help/description text |
| `.pen-icon-button` | `IconButton.tsx` | square 28×28 variant of `.pen-button` |
| `.pen-button-group` | `button-group.tsx` | flex row that joins adjacent `.pen-button`s (shared borders, outer radii only) |
| `.pen-input-group` | `input-group.tsx` | `.pen-input` + leading/trailing addon in one bordered row |
| `.pen-heading` | section titles | `text-primary`, 13px, weight 600 |
| `.pen-muted` | muted text | `text-muted` secondary text |
| `.pen-kbd` | keycaps | `surface-hover` bg, `border-default`, mono, small |
| `.pen-link` | text links | `accent-primary`, underline-on-hover |

Radio is intentionally omitted — the app has no radio primitive (it uses `select`).

## Contracts to keep green (both are two-sided, cross-repo)

1. **`pluginAllowlistContract.test.ts`** (`pen-editor`, runs against backend `main`):
   the skill's `## UI-kit classes` bulleted list must equal, as a set, **every**
   distinct `.pen-*` base class name in `PLUGIN_UI_KIT_STYLES`. Every new CSS class
   ⇒ one new bullet in `plugin.md`, and vice-versa. Compound/descendant selectors
   (`.pen-tab[aria-selected]`, `.pen-table th`) surface only their `.pen-*` base name,
   so keep helper subclasses to the documented names above (no undocumented
   `.pen-card-title`-style extras).
2. **`uiKitStyles.test.ts`**: every `var(--x)` must be in `THEME_CSS_VARS` — satisfied
   by using only existing tokens.

## Merge / release order

Same rule as the tool contract: **backend first, then frontend, back-to-back.** The
UI-kit contract test lives only in `pen-editor` and checks out backend `main` at run
time; backend CI never checks out the frontend. So land `plugin.md`'s new bullets on
backend `main` first (backend CI is green — it has no UI-kit sync test), then land the
`uiKitStyles.ts` CSS + test updates on frontend `main` (its contract job then passes
first try). While the gap is open the frontend contract job is red, so keep it short.

## Files touched

- `pen-editor-backend/src/skills/plugin.md` — add the new bullets under `## UI-kit
  classes`; extend prose/examples to mention the richer kit (e.g. a card + tabs example).
- `pen-editor/src/lib/plugins/uiKitStyles.ts` — add the CSS for every new class.
- `pen-editor/src/lib/plugins/__tests__/uiKitStyles.test.ts` — extend the documented-class
  assertion list to the full set.
- `pen-editor/src/lib/plugins/__tests__/bootstrap.test.ts` — (optional) extend the
  "includes the UI-kit stylesheet" assertions.
- The `pluginAllowlistContract.test.ts` sync check needs no edit — it validates the two
  lists automatically once both sides are updated.

## Testing

- `npm test` in both repos (frontend runs the cross-repo contract against the sibling
  backend checkout — must be updated first locally).
- `npm run lint` + `npm run build` in both.
- Manual/live smoke (optional, deferred): author a plugin using the new classes and
  confirm it renders and re-themes; hidden-tab iframe rAF makes browser-automation
  verification unreliable, consistent with prior plugin work.

## Out of scope

Framework/overlay-dependent primitives (dropdown, dialog, popover, combobox, context
menu, color picker, tooltip, toasts). New theme tokens. Changing the plugin RPC API or
tool allowlist.
