# Selection colors section — design

Date: 2026-07-09

## Goal

Add a **"Selection colors"** section to the Properties panel that aggregates every
unique solid color used across the current selection (Figma parity), each shown as
a swatch + hex row. Editing a swatch remaps that exact color everywhere it appears
in the selection. Mirrors Figma's "Selection colors" feature.

## Behavior

- **Aggregation scope:** all color-bearing fields on each selected node **and all of
  its descendants**:
  - fills — `getFills(node)` solid paints (`SolidPaint.color`) + legacy `fill`
  - stroke — `node.stroke` + path nodes' `pathStroke.fill`
  - effects — shadow colors: `effects[].color` (type `shadow`) + legacy `effect.color`
- **Grouping:** colors are normalized to an uppercase hex key and de-duplicated.
  Result is a stably-ordered list of `{ color, count }` (order = first-seen during the
  deterministic pre-order walk of selection roots then descendants).
- **Visibility:** the section renders whenever ≥1 color is collected, for both single
  and multi selections. Hidden when the collected list is empty.
- **Editing (color-only):** each row is a reusable `<ColorInput>` (swatch + hex text,
  **no opacity control**). Changing a row's color remaps every field whose normalized
  hex equals the old color to the new hex, across selection + descendants, in a single
  `updateMultipleNodes` call (one undo step).
- **Variable-bound colors are skipped** from aggregation. A paint/stroke/effect that
  carries a `colorBinding`/`*Binding` is managed through the variables system;
  including it would make "remap this hex" ambiguous. Documented, not rendered here.

## Out of scope

- Opacity display/editing per selection color.
- Variable-bound colors.
- Non-solid paints: gradient stops, image fills, pattern fills.
- Layout-grid colors, shader param colors.

## Modules

### `src/utils/selectionColors.ts` (new, pure)

```ts
export interface SelectionColor { color: string; count: number }

// Normalize any hex to canonical uppercase key, e.g. '#ff000080' -> '#FF000080',
// '#f00' -> '#FF0000'. Returns null for non-hex / unparseable input.
export function normalizeColorKey(hex: string): string | null

// Pre-order walk of roots + descendants; collect solid colors from fills/legacy
// fill, stroke/pathStroke.fill, shadow effects/legacy effect. Skip fields with a
// color binding. Dedup by normalized key, first-seen order.
export function collectSelectionColors(
  roots: SceneNode[],
  nodesById: Record<string, SceneNode>,
  childrenById: Record<string, string[]>,
): SelectionColor[]

// Build a { nodeId: Partial<SceneNode> } batch that rewrites every field whose
// normalized hex === normalizeColorKey(from) to `to`, across roots + descendants.
// Nodes with no matching field are omitted. Fill updates spread clearLegacyFillProps().
export function remapSelectionColor(
  roots: SceneNode[],
  nodesById: Record<string, SceneNode>,
  childrenById: Record<string, string[]>,
  from: string,
  to: string,
): Record<string, Partial<SceneNode>>
```

Remap rules per field:
- `fills`: map matching `SolidPaint` entries to `{ ...paint, color: to }`; write
  `{ fills: next, ...clearLegacyFillProps() }`.
- legacy `fill`: if it matches, set `fill: to`.
- `stroke`: if matches, set `stroke: to`.
- `pathStroke.fill` (path nodes): if matches, set `pathStroke: { ...pathStroke, fill: to }`.
- `effects`: map matching shadow entries; preserve/replace the whole color hex
  (shadow color carries baked alpha — remap replaces the full 8-digit hex, so the
  swatch's chosen hex wins; if `to` is 6-digit the alpha is dropped, matching a
  plain color edit). legacy `effect` handled the same way.

A field "matches" when `normalizeColorKey(field.color) === normalizeColorKey(from)`.

### `src/components/properties/SelectionColorsSection.tsx` (new)

- Props: `{ nodes: SceneNode[] }` (the selection roots).
- Reads `nodesById`, `childrenById`, `updateMultipleNodes` from `useSceneStore`.
- `const colors = collectSelectionColors(nodes, nodesById, childrenById)`.
- Returns `null` when `colors.length === 0`.
- Renders `<PropertySection title="Selection colors">` with one `<ColorInput>` per
  color (`value={c.color}`, `onChange={(next) => apply(c.color, next)}`), no opacity.
- `apply(from, to)`: `updateMultipleNodes(remapSelectionColor(nodes, nodesById, childrenById, from, to))`.

### Wiring

- `PropertyEditor.tsx` (single): render `<SelectionColorsSection nodes={[node]} />`
  at the bottom of the section stack.
- `MultiSelectPropertyEditor.tsx` (multi): render `<SelectionColorsSection nodes={selectedNodes} />`
  at the bottom.

## Testing (`src/utils/__tests__/selectionColors.test.ts`)

Against seeded stores (`resetStores()` / `seedScene()` from `src/test/fixtures.ts`):

- `normalizeColorKey`: 3/4/6/8-digit hex, casing, invalid input → null.
- `collectSelectionColors`:
  - dedups identical colors across nodes; counts occurrences.
  - walks descendants (nested frame/group children).
  - picks up fills, legacy `fill`, stroke, `pathStroke.fill`, shadow effect + legacy effect.
  - skips variable-bound fields.
  - empty selection / no colors → `[]`.
- `remapSelectionColor`:
  - rewrites matching fills and spreads `clearLegacyFillProps()`.
  - rewrites stroke, legacy fill, pathStroke.fill, shadow effect.
  - leaves non-matching nodes out of the batch.
  - preserves other paints/effects on a node with a partial match.

Contract test / name lists unaffected (no new AI tool). Lint clean, `npm run build`
type-checks.
