# Pixso paste: component-property resolution + auto-layout field remap

Date: 2026-07-22. Fixes the "complex Pixso structures lose data" bug: pasting a
heavily-componentised Pixso selection drops most nodes and leaves text empty.

## Ground-truth reproduction

Real capture: `src/lib/pixsoPaste/__tests__/fixtures/frame10.html` (Frame 10 from
the user's test file, 4407 source PixsoNodes). Running the **current** pipeline
(`convertPixsoClipboardHtml`) yields only **86 scene nodes**, 13 empty text nodes,
several `"◇\nSwap"` placeholders, and **0 warnings** — a silent, massive loss.

Node-type census of the payload: `INSTANCE:1627, FRAME:911, SYMBOL:794, TEXT:786,
RECTANGLE:119, VECTOR:111, BOOLEAN_OPERATION:53, CANVAS:2, LINE:2, ELLIPSE:2`.
**No `PROD_*` types** — everything is standard Figma-shaped. The loss is entirely
about **component instances**.

## Root cause

Pixso (like Figma) drives instance content through **component properties**, which
the current converter does not resolve at all:

- Symbol masters define props: `componentPropDef: [{ id{sessionID,localID}, name,
  type: 'TEXT'|'BOOL'|'INSTANCE_SWAP', initialValue{textValue,boolValue,guidValue} }]`.
- Master nodes bind a field to a prop: `componentPropRef: [{ defID, componentPropNodeField }]`
  where `componentPropNodeField ∈ { TEXT_DATA (→textData), VISIBLE (→visible),
  OVERRIDDEN_SYMBOL_ID (→instance swap), INHERIT_FILL_STYLE_ID (ignore) }`.
- Instances supply values: `componentPropAssignment: [{ defID, value{textValue,
  boolValue, guidValue} }]` — either on the instance root (302 instances) or nested
  in `symbolData.symbolOverrides[].componentPropAssignment` keyed by `guidPath`.

Because none of this is applied, text bound to a TEXT prop renders the master's
placeholder (`"Rag 123"` / empty), VISIBLE bools never toggle, and `INSTANCE_SWAP`
slots stay as the master's `"◇ Swap"` placeholder instead of expanding the swapped
component — which is what collapses ~4300 nodes.

Separately, Pixso's **auto-layout child** model differs from the Figma field names
the converter reads (confirmed against the kiwi schema + real geometry):

| converter reads (Figma) | Pixso field | mapping |
|---|---|---|
| `stackPositioning==='ABSOLUTE'` | `autoLayoutAbsolutePos: bool` | true → absolute |
| `stackChildPrimaryGrow>0` | `stackChildPrimarySizing: StackSize` | `RESIZE_TO_FIT` → fill primary (grow) |
| `stackChildAlignSelf==='STRETCH'` | `stackChildCounterSizing: StackSize` | `RESIZE_TO_FIT` → fill counter (stretch) |
| `stackVerticalPadding` (top) | `stackPaddingTop` | discrete; legacy combined is 0 |
| `stackHorizontalPadding` (left) | `stackPaddingLeft` | discrete; legacy combined is 0 |

`StackSize` enum has exactly `{FIXED, RESIZE_TO_FIT}`. Empirically (payload frame
"Form", width 960, padL/R 0): a child with `stackChildCounterSizing=FIXED` keeps its
own 309px width; a sibling with `RESIZE_TO_FIT` is 960px = parent inner width →
`RESIZE_TO_FIT` on a child axis means **fill**, not hug. Child HUG comes from the
child's *own* sizing (its container `stackPrimarySizing`/`textAutoResize`), handled
already by `hugSizing`.

Also: instance swaps can arrive as a direct `overriddenSymbolID` field (node or
override), which `convertInstance` currently ignores (it only reads
`symbolData.symbolID`).

## Design

### Part A — auto-layout field remap (in `adapt.ts`, Pixso→Figma aliasing)

Walk every node in the message once and, when the Pixso field is present, set the
Figma-named field the converter already reads:

- `autoLayoutAbsolutePos === true` → `stackPositioning = 'ABSOLUTE'`
- `stackChildPrimarySizing === 'RESIZE_TO_FIT'` → `stackChildPrimaryGrow = 1`
- `stackChildCounterSizing === 'RESIZE_TO_FIT'` → `stackChildAlignSelf = 'STRETCH'`
- `stackPaddingTop != null` → `stackVerticalPadding = stackPaddingTop`
- `stackPaddingLeft != null` → `stackHorizontalPadding = stackPaddingLeft`

This keeps the shared Figma converter untouched. Must run on master/symbol nodes,
instance nodes, AND nested `derivedSymbolData`/`symbolOverrides` entries that carry
these fields (do a deep walk that only touches these known keys).

### Part B — component-property resolution (new `figmaToScene/componentProps.ts`
wired into `convertInstance`/`convertNode`)

1. In `convertInstance`, choose the master via `change.overriddenSymbolID ??
   change.symbolData?.symbolID`.
2. Build a `Map<defIDKey, value>` for the instance from:
   - `change.componentPropAssignment` (root), and
   - every `change.symbolData.symbolOverrides[].componentPropAssignment` (all paths,
     merged; later entries win — path scoping is a refinement, flat merge recovers
     the bulk).
   Carry this map on `ConvertContext.componentProps` (merge with any inherited map
   from an outer instance so nested instances see parent-forwarded props).
3. In `convertNode`, after existing override merge, if the node has
   `componentPropRef`, for each ref whose `defID` resolves in the map:
   - `TEXT_DATA` → set `change.textData = value.textValue`
   - `VISIBLE` → set `change.visible = value.boolValue`
   - `OVERRIDDEN_SYMBOL_ID` → set `change.overriddenSymbolID = value.guidValue`
     (so the nested instance expands the swapped master)
   Ignore `INHERIT_FILL_STYLE_ID`. A `defID` of `{0,0}` never resolves (skip).
4. Respect resolved `visible === false` (already handled downstream; ensure the
   node is still emitted but hidden, matching Pixso).

Guard everything so a payload without these fields (Figma paste) is unaffected.

## Verification (hard gates)

Extend `repro.test.ts` (keep as a committed integration test) to assert on
`frame10.html`:
- `totalNodes` ≫ 86 (expect low-thousands once swaps expand; assert `> 800`).
- `emptyText` near 0 and **no** `"◇\nSwap"` / `"Rag"` placeholder text remains.
- resolved sample text includes real strings ("Documents", "Address", "General",
  "Next", email addresses, …).
- existing pixsoPaste + figmaPaste unit suites stay green (no Figma regression).

Then paste into the running editor and visually compare against the Pixso render.

## Post-implementation addenda (verified live in the editor)

- **Primary-axis child sizing is HUG, not fill.** Empirically a child's
  `stackChildPrimarySizing = RESIZE_TO_FIT` keeps its own content size (a 309px
  child in a 960px-inner row stayed 309), whereas `stackChildCounterSizing =
  RESIZE_TO_FIT` fills. So `adapt.ts` maps ONLY the counter axis to `STRETCH`;
  mapping the primary axis to `stackChildPrimaryGrow=1` wrongly stretched stacked
  rows to fill the parent and collapsed them, and was removed.

- **Part C — fit_content size normalization (`figmaToScene/fitContentSize.ts`).**
  A Pixso component *slot* stores the size of its authored placeholder; after an
  INSTANCE_SWAP / prop resolution expands it, the slot frame's stored size is far
  smaller than its real content. The Pixi frame renderer intentionally clamps a
  *clipped* fit_content frame to `min(intrinsicContent, node.height)` (commit
  237f440), so the stale-small size made the clip mask collapse over the real
  content — the pasted "Add new client" form rendered as a big empty panel even
  though every field node was present and correctly positioned. A post-order pass
  grows each non-wrapping auto-layout fit_content frame's stored size to at least
  its (already-normalized) children's laid-out extent. It only ever expands
  (`Math.max` with the stored value) so correct frames — all Figma paste, most
  Pixso frames — are untouched. Live result: the full multi-column form renders
  with clip still enabled, matching Pixso. `frame10` totalNodes 86 → 247, text
  resolved, no empty panels.
