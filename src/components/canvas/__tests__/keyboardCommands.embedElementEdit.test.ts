import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyDownHandlerDeps } from "../keyboardCommands";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { elementSelection, key, setupKeyDownHandler } from "./keyboardCommandFixtures";

/**
 * Round-2 code-review finding: Escape while a single-element inline text
 * edit is in flight (`EmbedLayer.tsx`'s dblclick-to-edit) must cancel the
 * EDIT and leave the picker's element `selection` untouched — not fall
 * through to `exitContainer()`, which sees that `selection` as leftover
 * state and clears it (dropping the highlight, bouncing the properties
 * panel back to the embed) as an unrelated side effect.
 *
 * Mirrors `keyboardCommands.embedElementSortable.test.ts`'s coverage for the
 * analogous `cancelElementDrag` callback exactly — same store-registered-
 * callback contract, same reason a capture-phase listener on the edited
 * element itself can't win this race (see `cancelElementEdit`'s doc comment
 * in `embedPickerStore.ts`).
 */
describe("keyboardCommands — Escape during an embed element inline text edit", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    ({ deps, handler } = setupKeyDownHandler());
    useEmbedPickerStore.getState().reset();
  });

  it("cancels the edit via the registered callback and leaves the element selection intact", () => {
    const cancel = vi.fn();
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().selectElement(elementSelection(), "<div>hi</div>");
    useEmbedPickerStore.getState().setCancelElementEdit(cancel);

    handler(key("Escape"));

    expect(cancel).toHaveBeenCalledTimes(1);
    // The whole point: exitContainer()'s own "clear a picked element" step
    // never ran, because this returned before reaching it.
    expect(useEmbedPickerStore.getState().selection?.embedId).toBe("e1");
    expect(deps.clearSelection).not.toHaveBeenCalled();
  });

  it("takes priority over cancelElementDrag when (hypothetically) both were registered", () => {
    // Not a reachable real state — drag and edit are mutually exclusive —
    // but pins the intended precedence order in the handler itself rather
    // than leaving it as an accident of code order.
    const cancelEdit = vi.fn();
    const cancelDrag = vi.fn();
    useEmbedPickerStore.getState().setCancelElementDrag(cancelDrag);
    useEmbedPickerStore.getState().setCancelElementEdit(cancelEdit);

    handler(key("Escape"));

    expect(cancelDrag).toHaveBeenCalledTimes(1);
    expect(cancelEdit).not.toHaveBeenCalled();
  });

  it("falls through to the ordinary Escape chain when no edit is in flight", () => {
    useEmbedPickerStore.getState().startPicking("e1");

    handler(key("Escape"));

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");
    expect(deps.clearSelection).toHaveBeenCalledTimes(1);
  });
});
