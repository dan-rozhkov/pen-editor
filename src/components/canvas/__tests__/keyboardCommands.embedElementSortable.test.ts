import { beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyDownHandler, type KeyDownHandlerDeps } from "../keyboardCommands";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";

function makeDeps(): KeyDownHandlerDeps {
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
 * Escape has to mean "cancel the element drag" while one is in flight inside
 * an embed, and "leave the picker" otherwise — the same two-step contract a
 * native-node drag gets via `useDragStore.cancelDrag`.
 *
 * This lives at the keyboardCommands level on purpose: the drag gesture used
 * to try to win this race from its own capture-phase `keydown` listener on
 * `window`, which cannot work — capture listeners on the SAME target fire in
 * registration order, and this global handler is registered at app mount,
 * before picking ever starts. The contract is therefore a callback this
 * handler looks up, not event ordering.
 */
describe("keyboardCommands — Escape during an embed element drag", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    deps = makeDeps();
    handler = createKeyDownHandler(deps);
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useEmbedPickerStore.getState().reset();
  });

  it("cancels the drag and leaves the picker running", () => {
    const cancel = vi.fn();
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().setCancelElementDrag(cancel);

    handler(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" }));

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");
    expect(deps.clearSelection).not.toHaveBeenCalled();
  });

  it("exits the picker when no drag is in flight", () => {
    useEmbedPickerStore.getState().startPicking("e1");

    handler(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" }));

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
  });
});

/**
 * The on-canvas agent composer (`AgentComposerButton`) closes on Escape from
 * its own textarea. This handler is registered on `window` in the CAPTURE
 * phase at app mount, so the composer cannot stop it by propagation — without
 * an `isTyping` guard, dismissing the composer also exited element-pick mode,
 * and a second Escape cleared the picked element.
 */
describe("keyboardCommands — Escape while typing", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    deps = makeDeps();
    handler = createKeyDownHandler(deps);
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useEmbedPickerStore.getState().reset();
  });

  function escapeFrom(target: EventTarget): KeyboardEvent {
    const e = new KeyboardEvent("keydown", { code: "Escape", key: "Escape" });
    Object.defineProperty(e, "target", { value: target });
    return e;
  }

  function composerTextarea(): HTMLTextAreaElement {
    const composer = document.createElement("div");
    composer.setAttribute("data-agent-composer", "");
    const textarea = document.createElement("textarea");
    composer.appendChild(textarea);
    document.body.appendChild(composer);
    return textarea;
  }

  it("leaves the picker and the selection alone when the agent composer has focus", () => {
    useEmbedPickerStore.getState().startPicking("e1");

    handler(escapeFrom(composerTextarea()));

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");
    expect(deps.clearSelection).not.toHaveBeenCalled();
  });

  // Deliberately NOT a blanket `isTyping` guard: leaving pick mode with focus
  // in an element-property field is a normal thing to want, and the picker is
  // what surfaced that panel.
  it("still exits the picker from a text field outside the composer", () => {
    useEmbedPickerStore.getState().startPicking("e1");
    const input = document.createElement("input");
    document.body.appendChild(input);

    handler(escapeFrom(input));

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
  });

  it("still exits the picker when the canvas itself has focus", () => {
    useEmbedPickerStore.getState().startPicking("e1");

    handler(escapeFrom(document.createElement("div")));

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
  });
});
