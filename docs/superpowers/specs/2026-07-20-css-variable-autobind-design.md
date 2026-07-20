# CSS variable auto-binding on paste/convert — design

**Date:** 2026-07-20
**Repos:** `html-capture` (capture side) + `pen-editor` (frontend consumer)
**Scope decision (user):** colors only, live-bound; light+dark values captured. Fonts and
spacing stay resolved/hardcoded — deliberately deferred (the pen-editor scene model has no
binding field for typography or auto-layout spacing yet; adding those means new node fields,
renderer resolution, properties-panel UI, and serialization — out of scope for this change).

## Problem

When HTML is pasted (h2d clipboard) or an embed is converted to design, every color comes
through as a hardcoded resolved value (`h2dToScene.ts` reads `node.styles` and drops the CSS
custom-property information). The capture bundle *already* emits per-node
`variableStyles: { color: "--primary", backgroundColor: "--surface", … }` (names only), but the
frontend ignores it. So a design authored against `--primary` etc. loses its token structure the
moment it lands in the editor, and switching the editor theme does nothing to it.

## Goal

Pasted/converted color values become **live bindings** to pen-editor `Variable`s created from the
file's CSS custom properties, so they re-resolve on theme switch instead of being frozen hex.

## Data flow

```
html-capture (en("body", { extractVariableDefinitions:true }))
  ├─ per-node  variableStyles: { <cssProp>: "--name" }      (already emitted)
  └─ document  cssVariables:   { "--name": { light, dark } } (NEW, opt-in)
        │
        ▼
pen-editor h2dToScene.convertH2dToSceneNodes(doc, { existingVariables })
  • for a node whose variableStyles binds a COLOR prop (color / backgroundColor / borderColor):
      – look up cssVariables[name] → {light,dark}, convert each to hex (parseColorWithOpacity)
      – reuse existing Variable by name, else mint color Variable { themeValues:{light,dark} }
      – set fillBinding / strokeBinding (text color → the text node's fill/primary paint)
      – keep the resolved hex as the node's fallback value
  • returns { nodes, warnings, variables:  <newly-created Variable[]> }
        │
        ▼
call sites (clipboardActions paste, complexOperations.convertEmbedToDesign)
  • addVariable() each returned new Variable into variableStore
        │
        ▼
renderer resolveColor(binding, activeTheme) already does live theme re-resolution
```

## Part A — html-capture

### New module `src/cssvars/definitions.ts`
`collectVariableDefinitions(root: Document | ShadowRoot): Record<string, { light: string; dark: string }>`

- Reuse the engine's stylesheet plumbing (`getActiveStylesheets`, `walkRules`) — export them from
  `engine.ts` as needed.
- Collect every custom-property (`--*`) declaration whose selector targets the document root
  (`:root`, `html`, or those plus a theme-toggle qualifier). Ignore custom props scoped to
  arbitrary components — this map is "the file's design tokens", i.e. root-level.
- Tag each declaration **dark** when it is inside `@media (prefers-color-scheme: dark)` **or** its
  selector carries a dark-toggle pattern: `.dark`, `.theme-dark`, `[data-theme="dark"]`,
  `[data-theme=dark]`, `[data-mode="dark"]`, `[data-color-mode="dark"]`, `html.dark`,
  `:root[data-theme="dark"]` (case-insensitive, substring match on the normalized selector).
  Everything else is **light** (including `prefers-color-scheme: light` and `.light`).
- Winner per (name, theme) = last declaration in source order (cascade proxy; root-level tokens
  rarely collide on specificity).
- Resolve nested `var(--other[, fallback])` references within the *same* theme's resolved map,
  iteratively, with a cycle guard (fall back to the raw string / fallback arg on cycle).
- `dark` defaults to the resolved `light` value when no dark scope defines the name.

### Output wiring
- `CaptureOptions` gains `extractVariableDefinitions?: boolean` (default `false`).
- `captureDocument` calls `collectVariableDefinitions` only when the flag is set, and attaches the
  result to the document as `cssVariables` (omit the field entirely when the flag is off or the map
  is empty).
- `captureToJson` (`en`) gains a matching argument threaded into `captureDocument`.
- **Parity:** the differential harness calls `en("body")` with the flag off, so the field is absent
  → byte-identical to the original. pen-editor opts in. This is an additive intentional divergence;
  document it in `html-capture/CLAUDE.md` under "Intentional divergences".

### Tests
- Unit tests for `collectVariableDefinitions`: light-only, light+dark via media query, light+dark via
  `.dark` class, `var()` nesting, cycle guard, source-order winner, non-root scope ignored.
- A fixture exercising the option through `en`.
- Rebuild `dist/capture.js`, then re-vendor into pen-editor (`src/vendor/h2dCapture/capture.js`).

## Part B — pen-editor

### Types (`src/lib/h2dPaste/h2dTypes.ts`)
- `H2dElementNode.variableStyles?: Record<string, string>`
- `H2dDocument.cssVariables?: Record<string, { light: string; dark: string }>`

### `src/lib/h2dCapture/captureEmbed.ts`
- Invoke the capture entry with `extractVariableDefinitions` enabled (the vendored `en` signature
  after the re-vendor).

### `src/lib/h2dPaste/h2dToScene.ts` (stays pure — no store imports)
- Signature: `convertH2dToSceneNodes(document, options?: { existingVariables?: Variable[] }): H2dConversionResult`
- `H2dConversionResult` gains `variables: Variable[]` — the **newly created** ones only.
- A `VariableResolver` closure over the ctx:
  - `resolveColorVar(cssVarName): string | null` (returns a `variableId` or null)
  - Looks up `document.cssVariables[cssVarName]`; converts `light`/`dark` to hex via
    `parseColorWithOpacity` (returns null → skip binding, value stays hardcoded — handles `oklch`
    etc.).
  - Dedup: existing Variable with the same name (from `existingVariables` or already-created this
    run) → reuse its id (first import wins, don't overwrite value); else mint
    `{ id, name: cssVarName without leading "--", type:'color', value: darkHexOrLight, themeValues:{light,dark} }`
    and record it in the returned `variables`.
- Binding application:
  - `applyBackground`: when `node.variableStyles?.backgroundColor` resolves → `base.fillBinding = { variableId }` (leave `base.fill` as the resolved fallback).
  - border color (`strokeFromStyles` path): when `node.variableStyles?.borderColor` (or the per-side
    top color) resolves → `base.strokeBinding = { variableId }`.
  - text color: in `convertTextElement`, when `node.variableStyles?.color` resolves → set the binding
    on whatever field the text renderer resolves (`fillBinding` on the text node, or `colorBinding`
    on its primary `SolidPaint` if `applyTextProps` produced a paint stack). Confirm against
    `getResolvedFill`/`getResolvedSolidPaint` during implementation.
- Only `color` / `backgroundColor` / `borderColor` keys of `variableStyles` are consulted. Any font
  or spacing entries are ignored.

### Call sites commit variables
- `src/store/sceneStore/complexOperations.ts#convertEmbedToDesign`: pass
  `{ existingVariables: get()`-adjacent `useVariableStore.getState().variables }`; after conversion,
  `useVariableStore.getState().addVariable(v)` for each returned new variable (before/with the same
  history step as the tree insert).
- `src/lib/h2dPaste/index.ts#convertH2dClipboardHtml` → its consumer
  `src/components/canvas/clipboardActions.ts` (~L274): same pattern — read existing variables in,
  commit new ones out.

### Tests (`src/lib/h2dPaste/__tests__/h2dToScene.test.ts`)
- Document with `cssVariables` + a node with `variableStyles.backgroundColor` → asserts
  `fillBinding.variableId` set, a color Variable returned with the right `themeValues`, and the
  resolved fallback fill preserved.
- Border color → `strokeBinding`. Text color → text-node binding.
- Dedup: a document reusing a name already in `existingVariables` → no new Variable, binding reuses
  the existing id.
- Unparseable color (`oklch(...)`) → no binding, value stays hardcoded, no Variable created.

## Sequencing (vendor order matters)
1. Implement + test Part A in `html-capture`; `npm run build`.
2. Copy `html-capture/dist/capture.js` → `pen-editor/src/vendor/h2dCapture/capture.js`.
3. Implement + test Part B in `pen-editor`.
4. Lint + unit tests + build both repos; live-check a paste produces bound Variables and theme
   switch re-colors them.

## Non-goals
- Font / spacing bindings (no scene model for them yet).
- Overwriting or reconciling pre-existing Variables that share a name (first import wins).
- Capturing component-scoped (non-root) custom properties as document tokens.
```
