# Properties panel: render isolation + draft-based numeric input

**Date:** 2026-07-17
**Status:** Design approved, ready for implementation plan
**Repo:** `pen-editor` (frontend only — no backend, no AI tool)

## Summary

Remove the two hottest wasted-work paths in the properties panel:

1. **Full-panel re-render on every scene mutation.** `PropertiesPanel`
   subscribes to `useSceneStore((s) => s.getNodes())` and to the entire
   `useSelectionStore()`. Any node change (including per-pointermove transient
   updates during canvas drag/resize at 60–120 Hz) invalidates the tree cache,
   rebuilds the whole node tree O(N), and re-renders all ~15–20 mounted
   sections. The panel must instead subscribe narrowly: to the selection and
   to the *selected node* via the flat `nodesById` map, so it re-renders only
   when the selected node itself changes.
2. **Store write + undo entry per keystroke.** The shared `NumberInput`
   (`src/components/ui/PropertyInputs.tsx:83-89`) is fully controlled and
   calls `onChange` on every keystroke, which flows into
   `updateNode` → `saveHistory` (one undo entry per character), a full tree
   rebuild, and a full panel re-render. Intermediate values ("12" on the way
   to "120") are applied to the canvas and trigger auto-layout.
   `NumberInput` gains a local draft layer: typing edits
   only local state, the store is committed once on blur/Enter, Escape
   reverts.

### Motivation

The scene store is well designed (flat maps with O(1) access, immutable
nodes, transient history-free updates during drag, rAF-coalesced Pixi sync),
but the React layer of the panel uses none of these advantages: broad
subscriptions, unstable prop references, and per-keystroke commits make the
panel the main render hotspot during canvas interaction and text input.

## Non-goals

Items from the analysis explicitly **out of scope** (follow-up work):

- No removal of Yoga layout computation from `SizeSection`'s render
  (analysis item 4 — read-from-layout-store is a separate change). We only
  replace its `getNodes()` subscription and `flattenTree(allNodes)` input
  gathering with flat-map materialization.
- No per-section `React.memo` rollout (analysis item 5), no slider
  `startBatch/endBatch` batching, no `FontCombobox` effect fix, no
  `IconContext.Provider` stabilization (item 6).
- No section collapsing / lazy mounting, no font-list virtualization
  (item 7).
- No render-count regression tests and no manual React Profiler audit —
  verification is unit tests for changed behavior plus the existing suite
  and `tsc` (agreed with the user).
- No visual/UX redesign: layout, styling, and control set stay identical.

## Design

### 1. Subscription architecture

Rule: **the panel works on flat maps; the tree is subscribed to only by the
branches that genuinely need it.**

`src/components/PropertiesPanel.tsx`:

- Remove `useSceneStore((s) => s.getNodes())` and the whole-store
  `useSelectionStore()` call. Replace with narrow selectors:
  `useSelectionStore((s) => s.selectedIds)`,
  `useSelectionStore((s) => s.instanceContext)`,
  `useSceneStore((s) => s.nodesById)`,
  `useSceneStore((s) => s.parentById)`,
  plus the existing `variables` / `activeTool` selectors.
  (`selectedIds` / `instanceContext` keep stable references across unrelated
  selection-store updates, so plain selectors suffice; if an action turns out
  to re-create an equal array, `useShallow` is the documented fallback.)
- Selected node: `selectedNode = selectedIds.length === 1 ? nodesById[selectedIds[0]] : null`
  — O(1). The panel re-renders when the *selected node object* changes
  (e.g. its X/Y during drag — fields stay live) or when the selection
  changes; mutations of unrelated nodes no longer re-render it.
- `parentContext`: new util `getParentContextFlat(nodesById, parentById, id)`
  in `src/utils/nodeUtils.ts`, returning
  `{ parent: FlatFrameNode | FlatGroupNode | null, isInsideAutoLayout }`
  where `isInsideAutoLayout = parent?.type === "frame" && !!parent?.layout?.autoLayout`
  (mirrors `findParentFrame`, `nodeUtils.ts:30-31`). Memoized on
  `[parentId, parentNode]`.
- `handleUpdate` → `useCallback` on `[selectedNode?.id]`.
- Tree-needing branches subscribe to the tree **themselves**, isolating
  re-renders in their subtree (rare modes, acceptable cost):
  - `DescendantPropertyEditor` (needs `component.children`) — subscribes to
    `getNodes()` internally instead of receiving `allNodes` as a prop.
  - `MultiSelectPropertyEditor` / `SpacingSection` (multi-select alignment)
    — keep/obtain their own tree subscription; the panel passes only
    `selectedIds` and flat `selectedNodes`.
- `FramePresetsPanel` and `PageProperties` branches are unchanged (they use
  `getState()` / their own narrow data).

`src/components/properties/PropertyEditor.tsx`:

- Wrapped in `React.memo` (pays off once props are stable).
- The `allNodes` tree prop is **removed** (a new array per mutation would
  defeat the memo). Component lookup becomes O(1) and flat:
  `node.type === "ref" ? nodesById[node.componentId] : null` (subscribed via
  selector) instead of `findComponentById(allNodes, ...)`. `AlignmentControls`
  (rendered inside `PositionSection`'s `alignment` slot) gets the data it
  needs from the maps or its own subscription — verified at implementation
  time (§2).
- `colorVariables` → `useMemo` on `[variables]`.
- `isOverridden` / `resetOverride` → `useCallback` on `[component, onUpdate]`.
- `nodes={[node]}` for `SelectionColorsSection` → memoized `[node]` array.

### 2. Flat-map adaptation of sections

The `node` prop and `parentContext.parent` become flat nodes everywhere in
the panel. Adaptation rule: **where a section reads `.children`, it
materializes the subtree from `nodesById`/`childrenById` via the existing
`materializeLayoutRefs`** (already used at `SizeSection.tsx:197-201`).

- `SizeSection.tsx`: replace the `getNodes()` subscription (:260) with
  `nodesById` / `childrenById` selectors. `computeSizeForMode` (:181-236)
  materializes the frame (fit_content branch) and the parent with children
  (fill_container branch) from the maps instead of reading `node.children` /
  `parent.children` / `flattenTree(allNodes)`. The Yoga computation itself
  and the displayed values are unchanged. One guard must be made explicit
  rather than inherited: the fit_content branches currently skip the synthetic
  merged multi-select node only as a side effect of testing
  `Array.isArray(node.children)`. That merged node carries the *first* selected
  node's id, so a flat-map rewrite would happily materialize that one node's
  children and present its intrinsic size as the whole selection's. Gate those
  branches on the existing `isMultiSelect` prop instead. The memo keys off the map
  references, so it recomputes only on real scene mutations (not on every
  parent render); fully removing Yoga from the render path stays out of
  scope (see Non-goals).
- `SelectionColorsSection.tsx`: keep the map subscriptions, memoize
  `collectSelectionColors` on `[selectedIds, nodesById, childrenById]` so it
  recomputes only on real scene mutations, not on every parent render.
- `ComponentPropertiesSection.tsx`: same treatment for
  `getComponentPropertyTargetOptions`.
- Implementation-time verification (covered by existing section tests):
  `PositionSection`, `ConstraintsSection`, `AlignmentControls` — expected to
  read only `parent` x/y/width/height; if any reads `children`, it gets the
  same materialization treatment.

### 3. NumberInput draft layer

`src/components/ui/PropertyInputs.tsx` (`NumberInput`, :69-167) — the single
shared control, so all sections get the fix automatically.

- Local state `draft: string | null` (`null` = not editing). While focused,
  the input shows the draft; when `draft === null`, it shows the formatted
  prop value (current `Math.round(value * 100) / 100` display logic
  unchanged).
- `onFocus`: capture current display value into `draft`.
- `onChange` while focused: `setDraft` only — no store writes; clearing the
  field works, and no intermediate value reaches the store.
  Caveat on partial input: the control stays `type="number"`, and such an input
  reports `.value === ""` while its content is not a valid number, so a draft of
  "-" or "1." arrives as `""`. In practice the field still behaves — the browser
  keeps the invalid text visible and React's controlled write of `""` is a no-op
  against an already-`""` `.value` — but this rests on browser bad-input
  behavior, not on the draft layer. Do not claim it as a guarantee, and do not
  write a unit test asserting it (happy-dom need not match Chrome here). Making
  partial input a real guarantee means moving to `type="text"` +
  `inputMode="decimal"`, which drops native spinners and the `spinbutton` role —
  out of scope.
- Commit (blur, Enter): `parseFloat(draft)` → NaN or empty → revert
  silently, no `onChange` call; otherwise clamp to `[min, max]` (when
  defined) → single `onChange(value)` → single undo entry. Enter also blurs.
- Escape: revert (`draft = null`) and blur without committing.
- `isMixed`: draft starts as `""` (placeholder "Mixed"); committing an
  empty/unparseable draft is a no-op.
- Scrub via `useScrubLabel` is unchanged — it already batches history with
  `startBatch/endBatch` and stays live.
- Accepted UX nuance (Figma-like): native `type=number` spinner clicks and
  external value changes (canvas drag of the selected node) are not
  reflected in the field while it is focused; the draft wins until blur.

### 4. Testing

New tests:

- `src/components/ui/__tests__/NumberInput.test.tsx`:
  typing fires no `onChange`; Enter commits exactly once and blurs; blur
  commits exactly once; Escape reverts without commit; invalid and empty
  input revert; min/max clamp on commit; `isMixed` empty-commit is a no-op;
  `isMixed` commits even when the typed value equals the displayed one (the
  other nodes in the selection may differ); read-only fields commit nothing on
  Enter or blur; scrub still emits a live `onChange` series.
- `src/utils/__tests__/nodeUtils.test.ts` (extend): `getParentContextFlat` —
  root node (no parent), nested node, `isInsideAutoLayout` true/false.

Existing suite must pass unchanged (behavior-preserving refactor):
`PropertiesPanel`, `RightSidebar`, `SizeSection`, `FillSection`,
`TypographySection`, `MultiSelectPropertyEditor`, `ComponentPropertiesSection`
tests, plus `tsc` typecheck.

### 5. Risks

- A section may implicitly rely on `children` in the `node` prop beyond the
  audited spots (`SizeSection`, `DescendantPropertyEditor`) — mitigated by
  the adaptation rule in §2, implementation-time grep, and the existing
  section tests.
- `selectedIds` could be re-created as an equal array by some selection
  action → rare extra re-render, harmless; `useShallow` is the fallback.
- Draft-vs-spinner UX nuance (§3) is accepted; tests pin the behavior.

## Verification

1. `npm run test` (vitest) in `pen-editor` — full suite green.
2. `npm run typecheck` (or `tsc --noEmit` per package.json script) — clean.
3. Manual smoke: select a frame → drag it on canvas (X/Y update live in the
   panel); type "120" into a width field (no intermediate canvas flashes,
   one undo step); Escape reverts.
