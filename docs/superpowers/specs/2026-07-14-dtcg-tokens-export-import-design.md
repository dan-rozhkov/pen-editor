# DTCG design-tokens converter + `.tokens.json` export/import

**Date:** 2026-07-14
**Status:** Design approved, ready for implementation plan
**Repo:** `pen-editor` (frontend only — no backend, no AI tool)

## Summary

Add a bidirectional converter between the pen-editor design-token stores
(variables, fill styles, effect styles, text styles) and the
[Design Tokens Community Group (DTCG)](https://tr.designtokens.org/format/)
JSON format. Surface it as two UI-only actions: **Export design tokens
(`.tokens.json`)** and **Import design tokens…**. No backend schema, no AI
tool, no cross-repo contract test.

### Motivation

DTCG is the emerging W3C-community standard for exchanging design tokens
between tools (Figma / Tokens Studio, Style Dictionary, Supernova, …). Making
`.pen` design tokens speak DTCG turns the editor into a real link in a
design-to-code pipeline: export tokens → run through Style Dictionary → CSS
vars / iOS / Android; or import a foreign token file to seed the editor's
variables and styles. Fits the "design-to-code" and portfolio direction of the
project.

## Non-goals

- No backend `/api/chat` tool and no `penTools` schema change → **no**
  `toolContract.test.ts` involvement.
- No Style Dictionary integration inside the app — we emit standards-compliant
  DTCG; downstream transformation is the user's build step.
- No image/pattern/video fills, no blur/background-blur effects in the standard
  output (not DTCG types) — skipped with a warning (see Limitations).
- No live/streaming sync — one-shot download and one-shot upload.

## Architecture

### Pure core module (isolated from Zustand)

```
src/lib/designTokens/
├── dtcgTypes.ts     # DtcgDocument / DtcgGroup / DtcgToken type defs
├── toDtcg.ts        # ExportInput → { document, warnings[] }
├── fromDtcg.ts      # DtcgDocument → { ImportResult, warnings[] }
├── tokenPath.ts     # "a/b/c" ↔ nested groups; alias "{a.b.c}" build/resolve
├── extensions.ts    # read/write $extensions["com.peneditor"]
├── __tests__/
│   ├── toDtcg.test.ts
│   ├── fromDtcg.test.ts
│   └── roundTrip.test.ts
└── index.ts
```

The core **does not import any store**. It operates on plain data:

```ts
interface ExportInput {
  variables: Variable[]
  fillStyles: FillStyle[]
  effectStyles: EffectStyle[]
  textStyles: TextStyle[]
}

interface ImportResult {
  variables: Variable[]
  fillStyles: FillStyle[]
  effectStyles: EffectStyle[]
  textStyles: TextStyle[]
}

function toDtcg(input: ExportInput): { document: DtcgDocument; warnings: string[] }
function fromDtcg(doc: DtcgDocument): { result: ImportResult; warnings: string[] }
```

This keeps the mapping unit-testable and makes the two directions symmetric.
The UI layer is the only place that touches Zustand.

### UI layer (download / upload only)

`src/lib/commands/fileCommands.ts` gains two commands (mirrored in the
Toolbar File menu, following the existing `exportAsJson` / `openDocument`
pattern):

- `file-export-tokens` → **Export design tokens (.tokens.json)**
- `file-import-tokens` → **Import design tokens…**

Export path:
1. Read `useVariableStore` / `useStyleStore` (`fillStyles`, `effectStyles`) /
   `useTextStyleStore`.
2. `toDtcg(input)` → `{ document, warnings }`.
3. Serialize `document` (pretty, 2-space) to a `Blob`
   (`application/json`), download as `<docName>.tokens.json` via an anchor
   (reuse the `saveBlob`/`triggerAnchorDownload` approach from
   `src/lib/downloadFile.ts`; extract a shared `downloadTextFile(text, name)`
   helper if none exists).
4. Toast summarizing `warnings` (e.g. "Exported 42 tokens. Skipped 3 image
   fills, 1 blur effect.").

Import path:
1. File picker limited to `.tokens.json,.json` (a small `openTokensFile()`
   analogous to `openFilePicker` in `fileUtils`).
2. `JSON.parse` → minimal shape validation → `fromDtcg(doc)`.
3. Merge into stores in **one history step**: call `setVariables` /
   `setFillStyles` / `setEffectStyles` / `setTextStyles` with the merged
   arrays. Wrap in a single `saveHistory` snapshot so undo reverts the whole
   import. (The store `setX` methods already snapshot via their own helpers;
   confirm during implementation that a single combined snapshot is taken — if
   each `setX` snapshots independently, take one manual snapshot up front and
   use the lowest-level setters, or add a batched import action.)
4. Toast summarizing added/updated counts and `warnings`.

## Type mapping

| Source | DTCG `$type` | `$value` | Notes |
|---|---|---|---|
| Variable `color` | `color` | `#hex` (light/base) | `dark` → `$extensions` |
| Variable `number` | `number` | number | spacing vs opacity semantics not distinguished (intentional) |
| Variable `string` | *(omitted)* | string | DTCG has no generic string type → no `$type`; logged as a warning |
| FillStyle solid | `color` | `#hex` **or** alias `{path.to.variable}` when `paint.colorBinding` is set | |
| FillStyle gradient | `gradient` | `[{ color, position }]` | gradient `type` (linear/radial) + coords → `$extensions` (DTCG `gradient` carries no geometry) |
| FillStyle image / pattern / video | — | — | **skipped** + warning |
| EffectStyle shadow(s) | `shadow` | shadow object, or array when multiple | `shadowType` → DTCG `inset` (inner⇒true); `offsetX/Y`, `blur`, `spread`, `color` |
| EffectStyle blur / background-blur | — | — | **skipped** + warning |
| TextStyle | `typography` | composite `{ fontFamily, fontSize, fontWeight, lineHeight, letterSpacing }` | `textTransform`, `fontVariations`, `fontFeatures` → `$extensions` |

Notes:
- 8-digit hex (`#RRGGBBAA`) is passed through as-is (valid DTCG hex notation).
- `fontSize`/`letterSpacing`/`lineHeight` are emitted as `number` in the
  typography composite (pen-editor stores them as unitless numbers). No
  `dimension` object conversion in v1 — keeps round-trip lossless for our own
  files.

## Identity & reversibility — `$extensions`

Every exported token carries a vendor extension under the reserved
`$extensions` key, namespace `com.peneditor`:

```json
{
  "$type": "color",
  "$value": "#3b82f6",
  "$extensions": {
    "com.peneditor": {
      "id": "var_ab12cd",
      "source": "variable",
      "themes": { "dark": "#0b0b0b" }
    }
  }
}
```

- `source`: `"variable" | "fillStyle" | "effectStyle" | "textStyle"`.
- `id`: original store id — lets an export→import round-trip restore the exact
  entity into the correct store.
- `themes.dark`: present only for a color variable that has `themeValues`
  (base `$value` = the light value).
- Type-specific overflow (gradient geometry, textTransform, fontVariations,
  fontFeatures) also lives here under descriptive keys.

**Foreign DTCG files** (no `com.peneditor` extension) import via heuristic on
`$type`: `color`→variable, `gradient`→fillStyle, `shadow`→effectStyle,
`typography`→textStyle. Fresh store ids are generated.

## Grouping & aliases

- A store name like `"brand/500"` maps to nested DTCG groups
  `brand → 500`. `$type` is hoisted to the group level where all children
  share it (spec-friendly), otherwise set per token.
- **Variables** are written at the document root by their name path — they are
  the Primitives/Semantics layers.
- **Fill / effect / text styles** are written under top-level groups `fill`,
  `effect`, `text` respectively, so their names cannot collide with variable
  names and the file reads predictably.
- `colorBinding.variableId` → resolve to the target variable's DTCG path →
  emit alias `{brand.500}`. If the target variable was deleted, emit the
  literal fallback value and add a warning.
- Name collisions within the same source group resolve last-writer-wins with a
  warning (identity is still recoverable from `com.peneditor.id`).

## Testing (Vitest, pure — no backend)

- `toDtcg.test.ts`: one case per source type incl. color-with-theme, solid fill
  with `colorBinding` alias, gradient, multi-shadow effect, typography with
  fontVariations. Assert `$type`/`$value`/`$extensions` shape.
- `fromDtcg.test.ts`: our-file import (round-trips ids) and foreign-file import
  (heuristic + generated ids); alias resolution back to `colorBinding`.
- `roundTrip.test.ts`: **property** — `fromDtcg(toDtcg(input).document).result`
  deep-equals `input` for the supported subset (image/blur/string-var excluded
  from the fixture). Guards symmetry.
- Skip cases: image fill, blur effect, string variable → assert each produces a
  `warnings[]` entry and does not throw.
- Follows the existing frontend test convention (`resetStores()`/`seedScene()`
  only if a test touches stores; the core tests use plain fixtures).

## Limitations (documented, intentional)

- **string variables**: no DTCG `$type` (standard has no generic string).
- **number variables**: emitted as `number`; spacing/opacity/duration
  semantics are not inferred.
- **gradient geometry** (angle/stops coords/radial radii), **textTransform**,
  **fontVariations**, **fontFeatures**: not standard DTCG → `$extensions` only.
  Tools that ignore `$extensions` lose these.
- **image / pattern / video fills**, **blur / background-blur effects**: no DTCG
  equivalent → skipped with a warning.
- Re-exporting our own file is lossless **except** for the above
  non-standard-and-not-in-`$extensions` cases (i.e. only the fully skipped
  kinds are dropped).

## Files touched (estimate)

New:
- `src/lib/designTokens/{dtcgTypes,toDtcg,fromDtcg,tokenPath,extensions,index}.ts`
- `src/lib/designTokens/__tests__/{toDtcg,fromDtcg,roundTrip}.test.ts`

Modified:
- `src/lib/commands/fileCommands.ts` — two new palette commands.
- Toolbar File menu component — two new menu items.
- `src/utils/fileUtils.ts` — `openTokensFile()` helper (+ maybe
  `downloadTextFile`).
- Possibly `src/lib/downloadFile.ts` — extract shared text-download helper.

## Versioning

Feature → minor bump of `pen-editor` only (backend untouched). Run
`npm version minor` in `pen-editor/` after implementation, per the repo's
SemVer convention.
