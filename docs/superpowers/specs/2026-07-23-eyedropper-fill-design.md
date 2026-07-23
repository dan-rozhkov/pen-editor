# Eyedropper (color picker) hotkey — design

**Date:** 2026-07-23
**Status:** approved (via /goal directive)

## Goal

Figma-style eyedropper. Pressing **`I`** samples a color from anywhere on
screen and applies it as the **Fill** of the currently selected node(s).

## Behavior (matches Figma)

- `I` (no modifiers, not typing in an input) → invoke the native browser
  `EyeDropper` picker.
- On pick → set the sampled hex as the fill of every selected node.
- On Escape / cancel → no change.
- Nothing selected → no-op (nothing to apply the color to).
- View / read-only mode → no-op (handled by the existing allowlist gate,
  which we intentionally do **not** add `KeyI` to — editing fills requires
  edit mode).
- Browser without `EyeDropper` (Firefox/Safari) → no-op (feature-detected,
  same flag `"EyeDropper" in window` already used in `ColorPicker.tsx`).

## Why native `EyeDropper`, not Pixi pixel sampling

The native API is already declared (`src/eyedropper.d.ts`) and used in
`ColorPicker.tsx`. It samples the whole screen (a superset of Figma's
in-canvas pick), returns `sRGBHex` — exactly the hex string shape
`SolidPaint.color` expects, no conversion. It provides its own magnifier
cursor and Escape handling, so **no custom Pixi cursor, overlay, or
`activeTool` mode is required**. Eyedropper is a fire-once action, not a
persistent draw tool — it does **not** become a `DrawToolType`.

## Implementation

### 1. Fill-apply helper — `src/lib/eyedropper.ts` (new)

`applyEyedropperColor(hex: string, selectedIds: string[]): void`

For each selected node, compute a `fills` update:
- If the node has a primary solid paint (`getPrimarySolidPaint`), replace its
  color via `updateFillAt(fills, index, { ...paint, color: hex })`.
- Else, set `fills` to `[createSolidPaint(hex)]`.
- Write `{ fills, ...clearLegacyFillProps() }`.

Commit:
- 1 node → `useSceneStore.getState().updateNode(id, update)` (one history entry).
- N nodes → `startBatch()` … per-node `updateNode` … `endBatch()` so the whole
  pick is a single undo step (per-node updates differ, so
  `updateMultipleNodes` with one shared `updates` object can't be used).

This module contains no DOM/EyeDropper calls, so it is fully unit-testable
against real Zustand stores.

### 2. Hotkey wiring — `src/components/canvas/keyboardCommands.ts`

Add a dedicated block **before** the generic `TOOL_BY_KEY_CODE` dispatch
(~line 568):

```ts
if (!isTyping && e.code === "KeyI" &&
    !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
  const ids = useSelectionStore.getState().selectedIds;
  if (ids.length > 0 && typeof window !== "undefined" && "EyeDropper" in window) {
    e.preventDefault();
    new window.EyeDropper!().open()
      .then((r) => applyEyedropperColor(r.sRGBHex, ids))
      .catch(() => {}); // cancelled / unsupported
  }
  return; // consume I even when no selection, to stay consistent
}
```

Capture `selectedIds` synchronously before opening (the native picker blocks
interaction, so selection can't change mid-pick).

### 3. Tests

- **Unit** (`src/lib/__tests__/eyedropper.test.ts`): seed a scene, select
  node(s), call `applyEyedropperColor("#ff0000", ids)`, assert fills updated
  (new-paint path and replace-existing-solid path), and that one undo entry
  is produced for a multi-node pick.
- **Keyboard** (extend `keyboardCommands` tests if present): stub
  `window.EyeDropper` to resolve `{ sRGBHex }`, dispatch `KeyI`, assert the
  helper applied the fill; assert no-op when selection is empty and when
  `EyeDropper` is absent.

## Out of scope (YAGNI)

- Toolbar button (Figma has none for eyedropper; hotkey is the interaction).
- Non-fill targets (stroke, text color).
- Fallback screen sampling for browsers lacking `EyeDropper`.
- Persistent eyedropper mode / custom cursor.
