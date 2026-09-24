import { vi } from "vitest";
import { createKeyDownHandler, type KeyDownHandlerDeps } from "../keyboardCommands";
import { useEditorModeStore, type EditorMode } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { EmbedElementSelection } from "@/lib/embedElementPicker";
import type { FlatSceneNode } from "@/types/scene";

// Shared setup for the `createKeyDownHandler` suites in this directory
// (keyboardCommands.*.test.ts, reorderHotkeys, styleHotkeys, tabNavigation).
// Mechanics only — every assertion stays in the test files.

/** A full set of injected deps, each a `vi.fn()` (value-returning ones return the "nothing happened" value). */
export function makeKeyDownDeps(): KeyDownHandlerDeps {
  return {
    dimensions: { width: 800, height: 600 },
    setIsSpacePressed: vi.fn(),
    setIsPanning: vi.fn(),
    deleteNode: vi.fn(),
    updateNode: vi.fn(),
    moveNode: vi.fn(),
    groupNodes: vi.fn(() => null),
    ungroupNodes: vi.fn(() => []),
    wrapInAutoLayoutFrame: vi.fn(() => null),
    booleanOperation: vi.fn(() => null),
    restoreSnapshot: vi.fn(),
    saveHistory: vi.fn(),
    startBatch: vi.fn(),
    endBatch: vi.fn(),
    undo: vi.fn(() => null),
    redo: vi.fn(() => null),
    fitToContent: vi.fn(),
    toggleTool: vi.fn(),
    cancelDrawing: vi.fn(),
    clearSelection: vi.fn(),
    copySelection: vi.fn(),
    cutSelection: vi.fn(),
    copyStyleSelection: vi.fn(),
    pasteStyleSelection: vi.fn(),
    copyAsCss: vi.fn(),
    copyAsSvg: vi.fn(),
  };
}

/**
 * Fresh mock deps + a handler closed over them, with `editorModeStore` put in
 * `mode` (no presentation state). Destructure into the suite's `let`s:
 * `beforeEach(() => { ({ deps, handler } = setupKeyDownHandler()); })`.
 */
export function setupKeyDownHandler(mode: EditorMode = "edit"): {
  deps: KeyDownHandlerDeps;
  handler: (e: KeyboardEvent) => void;
} {
  const deps = makeKeyDownDeps();
  const handler = createKeyDownHandler(deps);
  useEditorModeStore.setState({ mode, presentFrameIds: [], presentIndex: 0 });
  return { deps, handler };
}

/** A bubbling, cancelable keydown whose `key` mirrors `code` unless overridden. */
export function key(code: string, opts: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { code, key: code, bubbles: true, cancelable: true, ...opts });
}

/** `key(...)` as if dispatched from `target` (e.g. a focused input — the handler's typing guard reads `e.target`). */
export function keyFrom(
  target: EventTarget,
  code: string,
  opts: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  const event = key(code, opts);
  Object.defineProperty(event, "target", { value: target });
  return event;
}

/** An `<input>` attached to `document.body`, to dispatch keys "while typing" from. Caller removes it. */
export function appendInput(): HTMLInputElement {
  const input = document.createElement("input");
  document.body.appendChild(input);
  return input;
}

/** A single empty root frame `F`, selected, no entered container. */
export function seedSelectedFrame(): void {
  useSceneStore.setState({
    nodesById: { F: { id: "F", type: "frame", x: 0, y: 0, width: 10, height: 10, children: [] } } as never,
    parentById: {},
    childrenById: { F: [] },
    rootIds: ["F"],
  });
  useSelectionStore.setState({ selectedIds: ["F"], enteredContainerId: null } as never);
}

/** A single 100×100 root embed node holding `html`. Selection is left to the caller. */
export function seedEmbedNode(embedId: string, html: string): void {
  useSceneStore.setState({
    nodesById: {
      [embedId]: {
        id: embedId,
        type: "embed",
        name: "Embed",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        htmlContent: html,
      } as unknown as FlatSceneNode,
    },
    parentById: { [embedId]: null },
    childrenById: {},
    rootIds: [embedId],
  });
}

/** The `htmlContent` currently stored on embed node `embedId`. */
export function embedHtmlOf(embedId: string): string {
  return (useSceneStore.getState().nodesById[embedId] as unknown as { htmlContent: string }).htmlContent;
}

/** A picker selection for `<div>hi</div>` in embed `e1`; override any field. */
export function elementSelection(overrides: Partial<EmbedElementSelection> = {}): EmbedElementSelection {
  return {
    embedId: "e1",
    path: "div:nth-of-type(1)",
    tagName: "div",
    classes: [],
    textPreview: "hi",
    outerHtml: "<div>hi</div>",
    ...overrides,
  };
}
