import { beforeEach, describe, expect, it } from "vitest";
import type { KeyDownHandlerDeps } from "../keyboardCommands";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useCommentsStore } from "@/store/commentsStore";
import { key, setupKeyDownHandler } from "./keyboardCommandFixtures";

describe("keyboardCommands — comment mode (C / Shift+C)", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    ({ deps, handler } = setupKeyDownHandler());
    useSceneStore.setState({ nodesById: {}, parentById: {}, childrenById: {}, rootIds: [] } as never);
    useSelectionStore.setState({ selectedIds: [], enteredContainerId: null } as never);
    useDrawModeStore.setState({ activeTool: null });
    useCommentsStore.setState({ threads: [], draftAnchor: null, pinsHidden: false });
  });

  it("plain C enters comment mode", () => {
    handler(key("KeyC"));
    expect(useDrawModeStore.getState().activeTool).toBe("comment");
  });

  it("plain C again toggles comment mode back off", () => {
    handler(key("KeyC"));
    handler(key("KeyC"));
    expect(useDrawModeStore.getState().activeTool).toBeNull();
  });

  it("Shift+C toggles pin visibility without changing the tool", () => {
    handler(key("KeyC", { shiftKey: true }));
    expect(useCommentsStore.getState().pinsHidden).toBe(true);
    expect(useDrawModeStore.getState().activeTool).toBeNull();

    handler(key("KeyC", { shiftKey: true }));
    expect(useCommentsStore.getState().pinsHidden).toBe(false);
  });

  it("Cmd+Shift+C stays Copy-as-CSS (not the comment toggle)", () => {
    handler(key("KeyC", { metaKey: true, shiftKey: true }));
    expect(deps.copyAsCss).toHaveBeenCalled();
    expect(useCommentsStore.getState().pinsHidden).toBe(false);
  });

  it("Esc while in comment mode routes to cancelDrawing (which exits the tool + drops the draft)", () => {
    useDrawModeStore.setState({ activeTool: "comment" });
    handler(key("Escape"));
    expect(deps.cancelDrawing).toHaveBeenCalled();
  });

  it("plain N toggles the connector tool (moved off C by cmt-01)", () => {
    handler(key("KeyN"));
    // The tool-letter dispatch goes straight to the store (not the injected
    // `toggleTool` dep) — see keyboardCommands.tools.test.ts.
    expect(useDrawModeStore.getState().activeTool).toBe("connector");
  });
});
