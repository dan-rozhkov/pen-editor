import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyDownHandlerDeps } from "../keyboardCommands";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { appendInput, elementSelection, key, keyFrom, setupKeyDownHandler } from "./keyboardCommandFixtures";

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
    ({ deps, handler } = setupKeyDownHandler());
    useEmbedPickerStore.getState().reset();
  });

  it("cancels the drag and leaves the picker running", () => {
    const cancel = vi.fn();
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().setCancelElementDrag(cancel);

    handler(key("Escape"));

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");
    expect(deps.clearSelection).not.toHaveBeenCalled();
  });

  it("falls through to the ordinary Escape chain when no drag is in flight — picking mode itself is left running", () => {
    // With auto-start (useEmbedPickerLifecycle), Escape no longer turns
    // picking off directly — that would just be undone by the next check().
    // With nothing else to back out of (no selected element, no active
    // container/embed/editing state), exitContainer reports "not handled"
    // and clearSelection() runs — see keyboardCommands.embedElementDelete /
    // selectionStore.embedPicker.test.ts for the full chain.
    useEmbedPickerStore.getState().startPicking("e1");

    handler(key("Escape"));

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");
    expect(deps.clearSelection).toHaveBeenCalledTimes(1);
  });
});

/**
 * The on-canvas agent composer (`AgentComposerButton`) closes on Escape from
 * its own textarea. This handler is registered on `window` in the CAPTURE
 * phase at app mount, so the composer cannot stop it by propagation — without
 * an `isTyping` guard, dismissing the composer also cleared the picked
 * element. Outside the composer, Escape must still reach `exitContainer`,
 * whose first step clears that element.
 */
describe("keyboardCommands — Escape while typing", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    ({ deps, handler } = setupKeyDownHandler());
    useEmbedPickerStore.getState().reset();
  });

  function composerTextarea(): HTMLTextAreaElement {
    const composer = document.createElement("div");
    composer.setAttribute("data-agent-composer", "");
    const textarea = document.createElement("textarea");
    composer.appendChild(textarea);
    document.body.appendChild(composer);
    return textarea;
  }

  /** The picked element Escape is expected to clear (or leave alone). */
  function pickElement(): void {
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().selectElement(elementSelection());
  }

  it("leaves the picked element and the selection alone when the agent composer has focus", () => {
    pickElement();

    handler(keyFrom(composerTextarea(), "Escape"));

    expect(useEmbedPickerStore.getState().selection).not.toBeNull();
    expect(deps.clearSelection).not.toHaveBeenCalled();
  });

  // Deliberately NOT a blanket `isTyping` guard: leaving pick mode with focus
  // in an element-property field is a normal thing to want, and the picker is
  // what surfaced that panel.
  it("still clears the picked element from a text field outside the composer", () => {
    pickElement();
    const input = appendInput();

    handler(keyFrom(input, "Escape"));

    // Picking mode itself stays on — it is no longer a mode Escape can leave
    // (useEmbedPickerLifecycle re-arms it for as long as the embed is the
    // sole selection); the picked ELEMENT is what backs out here.
    expect(useEmbedPickerStore.getState().selection).toBeNull();
    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");
  });

  it("still clears the picked element when the canvas itself has focus", () => {
    pickElement();

    handler(keyFrom(document.createElement("div"), "Escape"));

    expect(useEmbedPickerStore.getState().selection).toBeNull();
    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");
  });
});
