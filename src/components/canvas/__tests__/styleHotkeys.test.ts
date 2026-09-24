import { beforeEach, describe, expect, it } from "vitest";
import type { KeyDownHandlerDeps } from "../keyboardCommands";
import { useEditorModeStore } from "@/store/editorModeStore";
import { key, seedSelectedFrame, setupKeyDownHandler } from "./keyboardCommandFixtures";

describe("keyboardCommands — copy/paste properties hotkeys", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    ({ deps, handler } = setupKeyDownHandler());
    seedSelectedFrame();
  });

  it("Cmd+Opt+C triggers copyStyleSelection, not the plain copySelection", () => {
    handler(key("KeyC", { metaKey: true, altKey: true }));
    expect(deps.copyStyleSelection).toHaveBeenCalledTimes(1);
    expect(deps.copySelection).not.toHaveBeenCalled();
  });

  it("Cmd+Opt+V triggers pasteStyleSelection", () => {
    handler(key("KeyV", { metaKey: true, altKey: true }));
    expect(deps.pasteStyleSelection).toHaveBeenCalledTimes(1);
  });

  it("plain Cmd+C still triggers copySelection", () => {
    handler(key("KeyC", { metaKey: true }));
    expect(deps.copySelection).toHaveBeenCalledTimes(1);
    expect(deps.copyStyleSelection).not.toHaveBeenCalled();
  });

  it("blocks Cmd+Opt+V (a mutation) in view mode", () => {
    useEditorModeStore.setState({ mode: "view", presentFrameIds: [], presentIndex: 0 });
    handler(key("KeyV", { metaKey: true, altKey: true }));
    expect(deps.pasteStyleSelection).not.toHaveBeenCalled();
  });

  it("Cmd+Shift+C triggers copyAsCss, not the plain copySelection", () => {
    handler(key("KeyC", { metaKey: true, shiftKey: true }));
    expect(deps.copyAsCss).toHaveBeenCalledTimes(1);
    expect(deps.copySelection).not.toHaveBeenCalled();
  });

  it("Cmd+Shift+S triggers copyAsSvg", () => {
    handler(key("KeyS", { metaKey: true, shiftKey: true }));
    expect(deps.copyAsSvg).toHaveBeenCalledTimes(1);
  });

  it("copyAsCss is allowed (non-mutating) in view mode", () => {
    useEditorModeStore.setState({ mode: "view", presentFrameIds: [], presentIndex: 0 });
    handler(key("KeyC", { metaKey: true, shiftKey: true }));
    expect(deps.copyAsCss).toHaveBeenCalledTimes(1);
  });
});
