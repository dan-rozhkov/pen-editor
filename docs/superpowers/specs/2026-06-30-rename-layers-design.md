# Design: AI layer renaming (`rename_layers` tool + `/rename-layers` skill)

Date: 2026-06-30

## Problem

Layers in a `.pen` document accumulate generic names (`Frame 12`, `Rect`, `Group`)
that make the layer tree hard to read. We want the AI design agent to rename layers
to logically meaningful names derived from each layer's role, content, and
hierarchy — in bulk, in a single undo step.

## Approach

Follow the existing **split-execution** architecture: declare a tool *schema* on the
backend (`penTools`) with **no `execute`** so it is dispatched to the browser, and
implement the *execution* as a frontend handler that mutates the Zustand scene graph.
Pair it with a backend **skill** that tells the agent how and when to use the tool.

The model already receives layer context through `get_editor_state` and `batch_get`
(type, name, text, hierarchy, selection), so the model does the naming *reasoning*;
the new tool only applies the chosen names.

## Components

### 1. `rename_layers` tool — backend schema

File: `pen-editor-backend/src/ai/tools.ts`, added to `penTools` in the
"Modification" section, **no `execute`** (client-executed).

```ts
rename_layers: tool({
  description:
    "Rename one or more layers (nodes) to logical, human-readable names in a " +
    "single undoable step. Provide the node id and the new name for each layer. " +
    "Use get_editor_state / batch_get first to read each layer's type, text " +
    "content, and hierarchy so names reflect the layer's role.",
  inputSchema: z.object({
    renames: z
      .array(
        z.object({
          id: z.string().describe("The node id to rename."),
          name: z.string().min(1).describe("The new layer name (non-empty)."),
        }),
      )
      .min(1)
      .describe("One {id, name} entry per layer to rename."),
  }),
}),
```

Rationale for a structured array (vs the `batch_design` mini-script string): renaming
is a flat id→name map with no nesting, so a typed array is simpler to validate and
needs no parser. zod enforces a non-empty array and non-empty names.

### 2. `renameLayers` handler — frontend execution

File: `pen-editor/src/lib/tools/renameLayers.ts`, exported as a `ToolHandler` and
registered in `pen-editor/src/lib/toolRegistry.ts` under `rename_layers`.

Behaviour:
1. Read `args.renames` (array of `{ id, name }`). Defensively also accept a
   JSON-string form (mirrors the lenient shape other tools accept) — parse it if a
   string is passed.
2. Read `useSceneStore.getState()`. Build a new `nodesById` applying
   `{ ...node, name: trimmedName }` for each entry whose `id` exists in the store.
   Trim each name; skip entries whose trimmed name is empty.
3. Collect `skipped` ids (id not found, or blank name after trim).
4. If at least one rename applies: `saveHistory(state)` once, then
   `useSceneStore.setState({ nodesById, _cachedTree: null })` — exactly **one** undo
   entry for the whole batch. (Parent/child/root maps are untouched — only `name`
   changes.)
5. Return `JSON.stringify({ renamed: <count>, skipped: <string[]> })`.
   On no input at all, return `{ error: "No renames provided" }`.

This mirrors `batchDesign`'s commit pattern (`saveHistory` + `setState` +
`_cachedTree: null`) but is much smaller because it only touches `name`.

### 3. `/rename-layers` skill — backend

File: `pen-editor-backend/src/skills/rename-layers.md`, with `name` / `description` /
`args` / `user-invokable: true` frontmatter (same shape as the existing skills).
Auto-loaded at startup by `src/ai/skills.ts`; invokable as `/rename-layers`.

Instructions tell the agent to:
1. **Read context** — call `get_editor_state` (to learn the current selection and top
   level) and `batch_get` (to read each candidate layer's `type`, text content, and
   children).
2. **Determine scope** — if the selection is non-empty, only rename the selected
   layers and their meaningful descendants; otherwise walk the whole document.
3. **Decide names** — concise, human-readable, reflecting role/content
   (e.g. a text node reading "Sign in" → `Sign in button`; a frame of inputs →
   `Login form`). Leave already-meaningful names alone.
4. **Apply** — call `rename_layers` **once** with all `{ id, name }` pairs so the
   rename is a single undo step. Use `{{ask_instruction}}` only if the document is
   empty or scope is genuinely ambiguous.

## Data flow

```
user "/rename-layers"  or  "rename my layers"
  → backend chat.ts streams an LLM turn; skill text injected for the slash command
  → model calls get_editor_state / batch_get  (read layer context)
  → model calls rename_layers { renames: [{id, name}, ...] }   (schema, no execute)
  → browser onToolCall → toolRegistry → renameLayers handler
  → handler: saveHistory once + setState(nodesById)            (one undo step)
  → returns { renamed, skipped } string → streamed back to the model
  → LayersPanel re-renders with the new names (getDisplayName reads node.name)
```

## Error handling

- Unknown ids and blank names are **non-fatal**: skipped and reported in `skipped`.
- Empty/absent `renames`: return `{ error: "No renames provided" }`, no store change,
  no history entry.
- A malformed JSON-string `renames` falls back to the error path rather than throwing.

## Testing

- **Frontend** `pen-editor/src/lib/tools/__tests__/renameLayers.test.ts` (Vitest +
  real Zustand via `seedScene()`): names applied to `nodesById`; unknown ids reported
  in `skipped`; blank names skipped; **exactly one** `historyStore.past` entry added
  for a multi-rename batch; empty input returns the error and leaves the store
  unchanged.
- **Backend** schema cases added to `test/tools-contract.test.ts`: `rename_layers`
  accepts a valid `renames` array, rejects an empty array, rejects blank names,
  rejects a missing `renames`. Update the two pinned name lists (the registry-name
  list in this file and `pen-editor/src/lib/__tests__/toolContract.test.ts`'s
  `EXPECTED_CLIENT_TOOLS`) so the cross-repo contract tests pass. `rename_layers`
  must remain absent from the `BACKEND_EXECUTED_TOOLS` list (it is client-executed).
- **Backend** `test/skills.test.ts` already loads every skill in `src/skills`; the new
  skill is covered by the existing "loads the real skills" / "no `{{ask_instruction}}`
  leakage" assertions. No new skill-specific test required, but confirm the suite
  still passes.

## Out of scope (YAGNI)

- No new read tool: existing `get_editor_state` / `batch_get` already expose enough
  layer context.
- No auto-rename heuristic in code: naming is the model's job; the tool only applies.
- No per-rename undo granularity: one batch = one undo entry, matching `batch_design`.
- No UI button: the feature is driven through chat / the `/rename-layers` command.
