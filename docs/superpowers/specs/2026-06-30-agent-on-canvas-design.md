# Agent on Canvas — Design

## Goal

When a single frame is selected on the canvas, show a small floating "+" button at
its top-right corner. Clicking it opens a mini popover with a text input and a send
button. On send, a new chat session is created in the Design Agent panel, the typed
text becomes the first user message, and the selected frame becomes the context
(screenshot + canvas-context JSON). Mirrors the Figma "Make designs" on-canvas
affordance.

## Existing architecture leveraged

- **Selection**: `useSelectionStore.selectedIds`; a frame is `nodesById[id].type === "frame"`.
- **On-canvas DOM overlay**: `EmbedActionBar.tsx` is the reference — absolute-positioned
  DOM inside the `PixiCanvas` container, world→screen via `useViewportStore` (`scale`,
  `x`, `y`) and `devicePixelRatio`. Node absolute position via
  `getNodeAbsolutePositionWithLayout()` (already wired as `getEditingPosition` in
  `PixiCanvas.tsx`).
- **Chat sessions**: `useChatStore.createTab()` creates and activates a tab and returns
  its id; `queueLaunchPayload(tabId, payload)` queues the first message. `ChatPanelContent`
  is **always mounted** (in `LeftSidebar.tsx`), so every session's `useDesignChat` auto-send
  effect fires once the session is `ready` — sending the queued payload regardless of panel
  visibility. The `parallelCount > 1` path in `ChatPanel.tsx` already uses exactly this
  `createTab()` → `queueLaunchPayload()` sequence.
- **Context**: `buildCanvasContext()` in `useDesignChat.ts` serializes the current
  selection (`selectedIds`, `selectedNodes`) on every request. A frame screenshot is
  captured via `captureNodeScreenshot(nodeId)` and attached as a `file`/image part.
- **Panel visibility**: `useLeftSidebarStore.setActiveSection("agents")` reveals the
  Design Agent panel.

## Components

| Unit | Type | Responsibility |
|---|---|---|
| `src/lib/launchFrameAgentChat.ts` | new | `async launchFrameAgentChat(frameId, text): Promise<boolean>` — trims text (no-op + return false if empty); captures the frame screenshot; `createTab()`; `queueLaunchPayload(tabId, { text, images })` (images present only if screenshot succeeded); `setActiveSection("agents")`. Pure orchestration over store `getState()` + `captureNodeScreenshot`, so unit-testable with mocks. |
| `src/components/canvas/FrameAgentButton.tsx` | new | Floating "+" button + popover. Props `{ node: FrameNode; absoluteX: number; absoluteY: number }`. Positions itself at the frame's top-right using the same world→screen math as `EmbedActionBar`. Local state: `open` (popover), `text`. On submit calls `launchFrameAgentChat(node.id, text)`, then closes + clears. `onPointerDown` stops propagation to the canvas. |
| `src/pixi/PixiCanvas.tsx` | edit | Add `selectedFrameNode` / `selectedFramePosition` memos mirroring `selectedEmbedNode` / `selectedEmbedPosition`; render `<FrameAgentButton>` when a single frame is selected and `editingMode === null` and the scene is editable. |

## Behavior details

- **Trigger**: exactly one selected node of `type === "frame"`, not currently inline-editing,
  and `canEditScene(editorMode)` is true (matches `EmbedActionBar` convention).
- **Button position**: anchored at frame top-right corner
  (`left = screenX + screenWidth`, `top = screenY`), offset above the corner via a
  `translate(-100%, calc(-100% - 8px))` transform so it sits just outside the frame.
- **Popover**: a `textarea` and a round send button (arrow-up icon). Enter submits,
  Shift+Enter inserts newline, Escape closes. Empty/whitespace text disables submit.
- **Context attached**: screenshot image part (when capture succeeds) + the standard
  `canvasContext` JSON (frame stays selected, so it is included automatically).
- **Lifecycle**: deselecting the frame unmounts the button, which closes the popover.

## Tests (TDD)

- `src/lib/__tests__/launchFrameAgentChat.test.ts`:
  - empty/whitespace text → returns false, no store mutations.
  - valid text → `createTab` called, `queueLaunchPayload` called with the text and an
    image built from the captured screenshot, `setActiveSection("agents")` called.
  - screenshot returns null → payload queued with no images (text only).
- `src/components/canvas/__tests__/FrameAgentButton.test.tsx`:
  - renders the "+" button; clicking opens the popover.
  - typing text + clicking send calls `launchFrameAgentChat(node.id, text)`.
  - empty text does not call `launchFrameAgentChat`; Escape closes the popover.

## Out of scope (YAGNI)

Multi-selection, non-frame nodes, draggable/repositionable popover, a separate
"agent-on-canvas" history distinct from the normal chat tabs.
