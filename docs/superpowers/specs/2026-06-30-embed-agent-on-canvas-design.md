# Embed "Agent on Canvas" — Design

## Goal

Give **embed nodes** the same on-canvas AI-agent affordance that **frame nodes**
already have (`FrameAgentButton`): a small sparkle trigger at the selected node's
top-right corner that opens a composer (textarea + send + quick actions).
Sending starts a fresh Design Agent chat seeded with the typed text, scoped to
the selected embed.

## Context

- Frame nodes already expose this via `FrameAgentButton` +
  `launchFrameAgentChat`, wired in `PixiCanvas.tsx`.
- Embed nodes ("code layers") render their HTML through a DOM/Shadow-DOM overlay
  (`EmbedLayer`); their PixiJS container is empty/invisible. So
  `captureNodeScreenshot` (which extracts from the Pixi scene graph) returns a
  blank/`null` image for embeds — a screenshot is not useful context.
- The embed agent button only appears while the embed is **selected**, so the
  embed's id is already in `canvasContext.selectedIds`. The backend reads the
  node from selection; no attachment is required.

## Decisions (locked)

1. **Context = selection only.** No screenshot for embeds. Rely on
   `selectedIds` in `canvasContext`.
2. **Quick actions = same as frame.** Reuse `FRAME_QUICK_ACTIONS` unchanged.
3. **Structure = DRY.** Generalize the shared logic; frame and embed are thin
   wrappers. No code duplication.

## Architecture

Five files, all in `pen-editor/src`:

### New core launch (`lib/launchNodeAgentChat.ts`)

```ts
launchNodeAgentChat(
  nodeId: string,
  text: string,
  opts?: { agentMode?: AgentMode; attachScreenshot?: boolean }, // attachScreenshot defaults true
): Promise<boolean>
```

Holds the logic currently in `launchFrameAgentChat`: trim → (optionally)
capture screenshot → build payload → `createTab` → `setTabAgentMode` →
`queueLaunchPayload` → reveal the agents panel. When `attachScreenshot` is
`false`, the screenshot step is skipped and no `images` are attached. No-op
(returns `false`) on empty/whitespace text.

### `lib/launchFrameAgentChat.ts` → thin wrapper

```ts
launchFrameAgentChat(frameId, text, agentMode?) =>
  launchNodeAgentChat(frameId, text, { agentMode, attachScreenshot: true })
```

Signature unchanged, so existing `FrameAgentButton` and its tests are untouched.

### `lib/launchEmbedAgentChat.ts` → thin wrapper (new)

```ts
launchEmbedAgentChat(embedId, text, agentMode?) =>
  launchNodeAgentChat(embedId, text, { agentMode, attachScreenshot: false })
```

Same `(id, text, mode?)` shape as the frame launcher, so the shared button can
call either interchangeably.

### `components/canvas/NodeAgentButton.tsx` (generalized from `FrameAgentButton`)

The current `FrameAgentButton` body, parameterized:

```ts
interface NodeAgentButtonProps {
  node: { id: string; width: number; height: number };
  absoluteX: number;
  absoluteY: number;
  placeholder: string;
  launch: (nodeId: string, text: string, mode?: AgentMode) => void | Promise<unknown>;
}
```

- `submit()` calls `launch(node.id, trimmed)`.
- `runQuickAction(a)` calls `launch(node.id, a.prompt, a.mode)`.
- Positioning, quick-action list (`FRAME_QUICK_ACTIONS`), keyboard handling, and
  pointer-stop behavior are exactly as today.

### `components/canvas/FrameAgentButton.tsx` → thin wrapper

Renders `NodeAgentButton` with `launch={launchFrameAgentChat}` and
`placeholder="Ask the agent about this frame…"`. Keeps the existing public
component and its test green (the test mocks `@/lib/launchFrameAgentChat` and
asserts the passed-through args).

### `components/canvas/EmbedAgentButton.tsx` → thin wrapper (new)

Renders `NodeAgentButton` with `launch={launchEmbedAgentChat}` and
`placeholder="Ask the agent about this embed…"`.

### `pixi/PixiCanvas.tsx` → render embed button

Add a render block next to the existing `EmbedSelectionFrame` / `EmbedActionBar`
blocks, reusing the already-computed `selectedEmbedNode` /
`selectedEmbedPosition`:

```tsx
{selectedEmbedNode && selectedEmbedPosition &&
 editingMode !== "embed" && canEditScene(editorMode) && (
  <EmbedAgentButton
    key={selectedEmbedNode.id}
    node={selectedEmbedNode}
    absoluteX={selectedEmbedPosition.x}
    absoluteY={selectedEmbedPosition.y}
  />
)}
```

Top-right placement matches the frame button and does not collide with
`EmbedActionBar` (top-center) or `EmbedSelectionFrame`.

## Data flow

1. User selects an embed → `EmbedAgentButton` appears (top-right).
2. User types a prompt (or clicks a quick action) → `launchEmbedAgentChat`.
3. `launchNodeAgentChat` creates a chat tab, queues the message (no image),
   reveals the agents panel.
4. The session auto-sends; `useDesignChat` builds `canvasContext` from the
   current selection (still the embed) → backend sees the embed via
   `selectedIds`.

## Error handling

- Empty/whitespace prompt → no-op (`launchNodeAgentChat` returns `false`).
- `attachScreenshot: false` → never calls `captureNodeScreenshot`; never throws
  on the blank-embed extraction path.

## Testing

TDD — write each test first, watch it fail, implement.

- `lib/__tests__/launchNodeAgentChat.test.ts` (new): tab creation + queued text;
  reveals/open agents panel; `attachScreenshot:true` attaches the named
  screenshot; `attachScreenshot:false` attaches no image (capture not called);
  no-op on empty text.
- `lib/__tests__/launchFrameAgentChat.test.ts` (existing): stays green — wrapper
  still attaches the screenshot.
- `lib/__tests__/launchEmbedAgentChat.test.ts` (new): delegates with no image
  even when capture would return data; forwards `agentMode`.
- `components/canvas/__tests__/NodeAgentButton.test.tsx` (new): open/close,
  submit, Enter/Shift+Enter, Escape, empty-block, quick actions — asserting the
  injected `launch` fn is called with the right args.
- `components/canvas/__tests__/FrameAgentButton.test.tsx` (existing): stays
  green.
- `components/canvas/__tests__/EmbedAgentButton.test.tsx` (new): renders the
  trigger; on send calls `launchEmbedAgentChat`; embed placeholder text.

`PixiCanvas` wiring is covered visually / by e2e (Pixi-coordinate UI is not unit
tested), consistent with how the frame button is treated.

## Out of scope (YAGNI)

- Rendering embed HTML to an image for visual context (rejected: extra
  dependency/complexity; selection already identifies the node).
- Embed-specific quick actions (using the frame set as-is per decision).
