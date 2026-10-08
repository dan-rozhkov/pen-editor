# Embed HTML Components — Design

**Status:** decided 2026-10-08. Replaces Phase 3 ("Components v2", native) of the local roadmap `docs/superpowers/plans/2026-10-08-enterprise-grade-design-systems.md`. The owner does not want native (Pixi scene-graph) components. Components live inside `embed` HTML.

## Goal

A component is defined once and used in many embed screens. An edit of the component updates every embed that uses it, on every page.

## Why the old HTML components failed

`f020802a` (2026-09-15) removed `<c-*>` tags, `documentComponents`, `EmbedNode.sourceTemplate` and `componentArtifactsById`. The commit gives no reason. The code shows these defects:

1. **Two texts.** `sourceTemplate` (authored, with `<c-*>` tags) and `htmlContent` (expanded). Each writer had to know which text to edit. The element picker and the properties panel wrote `htmlContent`, and the next expansion erased their edits.
2. **Rename and delete erased screens.** An unexpanded template stored as `htmlContent` lost its markup when a tag stopped resolving.
3. **Fragile tag regex.** `i<c-1` inside a script matched as a component tag and blocked edits.
4. **Order traps.** Image-URL repair had to run before expansion, or a typo came back on every propagation.
5. **Second source of truth.** Native frame → HTML artifact sync with a `syncState` machine.
6. **Propagation holes.** Only `updateNode` and the `batch_design` finalize step propagated. Undo/redo and the picker did not.
7. **A 547-line hand-written tag scanner.**
8. **Cross-page masters** needed special injection.
9. **About 120 prompt lines** to make the model use components.

## Constraint: every consumer reads `htmlContent` as plain HTML

The canvas mounts embed HTML into a shadow root after DOMPurify, which removes scripts. The texture renderer, the streaming preview (`morphDom`), h2d capture, PNG/SVG/PDF/PPTX export, showcase publish (Playwright on the backend), the backend showcase runner, share links, taste-check and embed lint all read the raw string. None of them can run a component registry.

So runtime Custom Elements (scripts stripped, eight consumers break), Declarative Shadow DOM (sanitizer and h2d) and Lit/htmx (need a runtime) are rejected.

## Decision: always-expanded HTML with marked instance regions

### One stored text

`htmlContent` always holds plain, expanded HTML. There is no `sourceTemplate`. An instance is a normal element with inert `data-*` markers. Every consumer above works with no change.

### Master

A master is an ordinary embed node with a `component` field:

```ts
interface EmbedComponentMeta {
  key: string;            // stable slug, never renamed, e.g. "btn"
  name: string;           // display name, may change
  description?: string;
  variants?: Record<string, string[]>;   // axis -> allowed values
  status?: "draft" | "stable" | "deprecated";
  deprecated?: { replacedBy?: string; note?: string };
}
interface EmbedNode { /* … */ component?: EmbedComponentMeta }
```

- The registry is a derived, memoized selector over every page: all embeds with `component`. There is no second document-level store.
- Masters live on a page named "Components". Export, slides and showcase publish skip embeds that have `component`.
- If two masters share a key (a forced copy), the first in page order wins and `get_editor_state` reports a warning. Duplicating a page or a node strips `component` from the copies.
- Master HTML rules, validated when the master is defined:
  - One root element with `data-c="<key>"`.
  - Slots are elements with `data-c-slot="<name>"`. Their content in the master is the default.
  - Variants are `data-v-<axis>="<value>"` attributes on the root.
  - One `<style>` block whose selectors all start with `[data-c="<key>"]`. The validator scopes bare selectors automatically: a selector gets both the root form (`button[data-c="k"]`, `.x[data-c="k"]`) and the descendant form (`[data-c="k"] button`). `@import` and `@charset` are hoisted to the top of the block.
  - The root's inline `style` stays inline. A rendered instance gets `masterStyle; instanceStyle`, so instance declarations win. The rendered region records the master style it merged in as `data-c-ms="<masterStyle>"` (stored HTML only, ignored by consumers, absent when the master has no root style). Reading an instance strips that recorded prefix, not the current master style, so a later master style change never leaves old master declarations behind as instance style. Regions without the attribute fall back to the current master style.
  - `<c-KEY>` tags inside master HTML are expanded at define time. A master that contains its own tag is refused. A tag with no registered key is left as written and reported as an unknown tag; defining that key later expands it in every master and consumer embed that still holds the raw tag.
  - Colors, radii and spacing use `var(--token)`.

```html
<style>
  [data-c="btn"] { padding: var(--space-2) var(--space-4); border-radius: var(--radius-md); }
  [data-c="btn"][data-v-kind="primary"] { background: var(--color-accent); color: var(--color-on-accent); }
</style>
<button data-c="btn" data-v-kind="primary"><span data-c-slot="label">Save</span></button>
```

### Instance (stored form)

A clone of the master root, with the instance's variant attributes, its own slot content and a revision stamp:

```html
<button data-c="btn" data-v-kind="secondary" data-c-rev="a1f3"><span data-c-slot="label">Cancel</span></button>
```

- **Managed zone:** everything in the region outside slot elements. Only the master controls it.
- **Free zone:** slot contents. Instances own them. A slot may contain nested instances.
- The component CSS is a managed `<style data-c-style="<key>">` block in each consuming embed. It is added with the first instance and removed with the last.
- An instance may also carry its own `style` and `id` attributes. Nothing else overrides the master. To change more, the user or the agent detaches the instance.

### Propagation

`reconcileComponent(key)`:

1. Render the master once. Compute `rev` = short hash of master HTML + variants.
2. Find every embed on every page (active page store and `pageStore` snapshots) whose `htmlContent` contains `data-c="<key>"` (string prefilter).
3. Parse each with DOMParser. For each region, deepest first: read the variant attributes, the instance `style`/`id` and the slot contents. Clone the master root. Apply the variants and attributes. Put each slot's instance content in place; a slot the instance lacks keeps the master default. Replace the region. Set `data-c-rev`.
4. Sync the managed `<style>` block.
5. Serialize with `serializeEmbedDoc`, which keeps fragment vs full-document shape.

Triggers:

- A store subscriber on master `htmlContent`/`component` changes runs reconcile in the same history step as the master edit, so undo and redo restore master and consumers together.
- Lazy catch-up: a region whose `data-c-rev` differs from the master `rev` is reconciled on document open, on page activation, and before export or publish. This repairs every missed trigger, pasted regions and inactive pages.
- Reconcile is idempotent.
- Nested components reconcile in dependency order. A dependency cycle is refused when the master is defined. A master counts as a consumer of the keys it contains: editing `btn` first rewrites the stored `btn` region inside the `card` master, which changes `card`'s rev and then re-renders every `card` instance, all in the same undo step.
- The master refresh runs to a fixed point: each pass re-plans only the masters that mention a key rewritten in the previous pass, up to 12 passes (a deeper chain logs a warning). The lazy catch-up refreshes stale masters the same way. A master is reconciled without its own key, so its own root is never re-rendered from the registry (a shadowed duplicate master keeps its own content).
- The write guard compares a region's managed zone with its own `data-v-*` ignored; `data-v-*` on nested regions inside the managed zone count, because the master sets them.
- A region whose key has no master stays as static HTML. Nothing is erased.

### Authoring by the agent

Input may use tag form. A pure `expandComponentTags(html, registry)` runs at the `normalizeEmbedNode` choke point in `batch_design`, in `edit_embed_html`, and in the streaming preview before mount:

```html
<c-btn kind="secondary"><c-slot name="label">Cancel</c-slot></c-btn>
<c-btn kind="primary">Save</c-btn>   <!-- bare content goes to the first slot -->
```

- Only **registered keys** match (`<c-(btn|card)(?=[\s/>])`), and the scan skips `<script>`, `<style>` and comments. This closes the `i<c-1` defect.
- A self-closing `<c-btn />` is normalized to a pair first.
- An unregistered `<c-x>` stays as is and the tool result names it, so the agent can define it.
- Streaming preview: `repairPartialHtml` drops a partial tag (`<c-btn kind="pri`) before expansion.

Reads: `read_embed_html` gets `view: "compact" | "expanded"`. Compact collapses each canonical region back to tag form, so a screen with twenty buttons costs twenty short tags. `edit_embed_html` anchors match the compact view, and the result expands again. `expand(collapse(h)) === h` for canonical regions is a tested invariant. Compact view ships in step 2, not step 1.

Write guard (variant attributes `data-v-*` are instance data and never count as managed): a write that changes a managed zone (the region no longer equals `render(master, variants, slots)`) is refused with "region `<key>` is component-managed; edit the master or detach it". Slot edits, variant changes, and inserting or deleting whole regions are allowed. The element picker, properties panel and inline editor use the same guard and offer "Edit main component" / "Detach" on managed elements.

### Tools (backend schema first, then frontend handler)

| Tool | Args | Effect |
|---|---|---|
| `define_component` | `{key, name, html, variants?, description?, status?}` | Create or update a master on the Components page. Validates the master rules. Reconciles all instances. |
| `extract_component` | `{nodeId, selector, key, name, replaceSimilar?}` | Promote an element of an embed to a master and replace it (and, optionally, structurally equal elements in other embeds) with instances. Text-only leaves become slots. Matching screen CSS is copied, together with `@import`, `@font-face` and used `@keyframes`. "Structurally equal" compares tags, classes, other attributes including `data-*`, and child structure. |
| `detach_instance` | `{nodeId, selector}` | Remove the markers from one region. The look stays: the master CSS is re-scoped into a static `<style data-d-style>` block. |
| `delete_component` | `{key}` | Detach every instance, then delete the master. Never erases instance markup. |

`get_editor_state` gains `components: [{key, name, status, variants, slots, usedBy: count}]`. `get_design_system` (roadmap Phase 4) includes the same list. The master is readable with `read_embed_html`.

Each tool name must be added in the seven known places (`penTools`, two backend contract lists, `EXPECTED_CLIENT_TOOLS`, `toolRegistry`, `toolIcons`, `toolDisplayNames`, and a timeout override only if it can run over 30 s).

### Showcase runner

The backend runner has no scene graph. V1 stubs the four component tools there like other client-executed tools. The prototype skill keeps working without components.

### How each old defect is avoided

| Old defect | Avoided by |
|---|---|
| Two texts | One stored text. The master is the only other source. |
| Rename/delete erased screens | Keys never change. Delete always detaches. An unknown key degrades to static HTML. |
| Tag regex | Only registered keys match, script/style/comments skipped. Stored regions are found by DOM, not regex. |
| Edits overwritten | Write guard plus a defined free zone. Picker and inline editor route through the guard. |
| Repair order | Repairs act on stored text. The master is repaired once at define time. |
| Native/HTML sync | HTML only. |
| Propagation holes | Subscriber in the same history step plus `data-c-rev` lazy catch-up. |
| Cross-page masters | Document-wide reconcile over `pageStore` snapshots. |
| Prompt cost | Compact view and one rule: "use `<c-key>` when the key is registered". |

## Rollout

1. Master meta, `expandComponentTags`, `reconcileComponent`, triggers, write guard, the four tools, `get_editor_state.components`.
2. Compact read view in `read_embed_html`/`edit_embed_html`, streaming preview expansion, prompt rule, `build-design-system` skill. **Frontend half done:** `collapseComponentRegions` (`src/lib/embedComponents/collapse.ts`), `view` on both tools (compact by default; a compact-view miss retries on the expanded text and says so; a master is always read and edited as stored), and `repairAndExpandPartialHtml` in the streaming preview. Backend schema, prompt rule and skill are separate.
3. Components panel (list, usage count, go to master), picker "Edit main component" / "Detach". **Done:** `ComponentsPanel` (`src/components/ComponentsPanel.tsx`, rail section "Components", hidden in shared view and in the embed widget): search, status and library badges, usage counts, duplicate-key warnings, "Go to master" (switch page, select, fit), "Insert instance" (writes `<c-KEY>` after the picked element, else at the end of `<body>`, through `finalizeEmbedHtml`; disabled without a selected non-master embed and in read-only mode), and a meta form for local masters that saves through the `define_component` handler (which now also takes a panel-only `deprecated` argument and clears `status`/`description`/`deprecated` on `null`/empty). Library masters are read-only. In the properties panel, an element picked in the managed zone of an instance shows "Edit main component" and "Detach" (`EmbedComponentRegionActions`, region lookup in `src/lib/embedComponents/pickerContext.ts`); slot content edits as before.

## Risks

- DOMParser re-serialization normalizes markup. Reconcile only embeds that pass the prefilter, and only rewrite when a region changed.
- CSS prefixing must be checked against the `foreignObject` texture path.
- Overrides are limited to variants, slots, `style` and `id`. If that is too strict, the next step is named property slots, not free overrides.
