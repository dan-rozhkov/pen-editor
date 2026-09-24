import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KeyDownHandlerDeps } from "../keyboardCommands";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSharedViewStore } from "@/store/sharedViewStore";
import { key, seedSelectedFrame, setupKeyDownHandler } from "./keyboardCommandFixtures";

describe("keyboardCommands — view mode gating", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    ({ deps, handler } = setupKeyDownHandler("view"));
    seedSelectedFrame();
  });

  it("does not delete on Delete/Backspace in view mode", () => {
    handler(key("Delete"));
    handler(key("Backspace"));
    expect(deps.deleteNode).not.toHaveBeenCalled();
  });

  it("does not nudge with arrow keys in view mode", () => {
    handler(key("ArrowLeft"));
    handler(key("ArrowRight"));
    expect(deps.moveNode).not.toHaveBeenCalled();
    expect(deps.updateNode).not.toHaveBeenCalled();
  });

  it("does not group or cut in view mode", () => {
    handler(key("KeyG", { metaKey: true }));
    handler(key("KeyX", { metaKey: true }));
    expect(deps.groupNodes).not.toHaveBeenCalled();
    expect(deps.cutSelection).not.toHaveBeenCalled();
  });

  it("still allows copy and fit-to-content in view mode", () => {
    handler(key("KeyC", { metaKey: true }));
    handler(key("Digit0", { metaKey: true }));
    expect(deps.copySelection).toHaveBeenCalledTimes(1);
    expect(deps.fitToContent).toHaveBeenCalledTimes(1);
  });

  it("Escape exits view mode", () => {
    handler(key("Escape"));
    expect(useEditorModeStore.getState().mode).toBe("edit");
  });

  describe("in the shared-canvas viewer (isSharedView)", () => {
    afterEach(() => {
      useSharedViewStore.setState({ isSharedView: false });
    });

    it("Escape does NOT exit view mode — the 'View only' bar promises no in-app way to become editable", () => {
      useSharedViewStore.setState({ isSharedView: true });
      handler(key("Escape"));
      expect(useEditorModeStore.getState().mode).toBe("view");
    });

    it("Escape still exits view mode for a plain ?view link (isSharedView false)", () => {
      useSharedViewStore.setState({ isSharedView: false });
      handler(key("Escape"));
      expect(useEditorModeStore.getState().mode).toBe("edit");
    });
  });

  it("in edit mode, Delete still deletes (gating only applies to view/present)", () => {
    useEditorModeStore.setState({ mode: "edit" });
    handler(key("Delete"));
    expect(deps.deleteNode).toHaveBeenCalledWith("F");
  });

  it("Cmd+Z (undo) does not trigger deps.undo in view mode", () => {
    handler(key("KeyZ", { metaKey: true }));
    expect(deps.undo).not.toHaveBeenCalled();
  });

  it("Cmd+Shift+Z (redo) does not trigger deps.redo in view mode", () => {
    handler(key("KeyZ", { metaKey: true, shiftKey: true }));
    expect(deps.redo).not.toHaveBeenCalled();
  });
});
