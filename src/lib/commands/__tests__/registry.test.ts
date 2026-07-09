import { describe, it, expect, beforeEach } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { getCommands } from "../registry";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useUIVisibilityStore } from "@/store/uiVisibilityStore";
import { ALL_TOOLS } from "@/lib/toolDefinitions";

beforeEach(() => {
  resetStores();
  useDrawModeStore.setState({ activeTool: null });
  useUIVisibilityStore.setState({ isUIHidden: false });
});

describe("getCommands", () => {
  it("has no duplicate ids", () => {
    const ids = getCommands().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every command has a non-empty label and a run function", () => {
    for (const command of getCommands()) {
      expect(command.label.length).toBeGreaterThan(0);
      expect(typeof command.run).toBe("function");
    }
  });

  it("includes one Tools command per tool definition", () => {
    const toolCommands = getCommands().filter((c) => c.group === "Tools");
    expect(toolCommands.length).toBe(ALL_TOOLS.length);
  });

  it("includes the core Edit/View/File actions", () => {
    const ids = getCommands().map((c) => c.id);
    for (const id of [
      "edit-undo",
      "edit-redo",
      "edit-copy",
      "edit-paste",
      "edit-select-all",
      "view-toggle-ui",
      "file-open",
    ]) {
      expect(ids).toContain(id);
    }
  });
});

describe("command dispatch", () => {
  it("running a tool command activates that tool via drawModeStore", () => {
    const rectCommand = getCommands().find((c) => c.id === "tool-rect");
    expect(rectCommand).toBeDefined();
    rectCommand!.run();
    expect(useDrawModeStore.getState().activeTool).toBe("rect");
  });

  it("running the Select tool command clears the active tool", () => {
    useDrawModeStore.getState().setActiveTool("rect");
    const selectCommand = getCommands().find((c) => c.id === "tool-cursor");
    selectCommand!.run();
    expect(useDrawModeStore.getState().activeTool).toBeNull();
  });

  it("running edit-select-all selects every top-level node", () => {
    seedScene();
    const selectAll = getCommands().find((c) => c.id === "edit-select-all");
    selectAll!.run();
    expect(useSelectionStore.getState().selectedIds.length).toBeGreaterThan(0);
  });

  it("running edit-undo restores the previous snapshot", () => {
    seedScene();
    const snapshotBefore = createSnapshot(useSceneStore.getState());
    useHistoryStore.getState().saveHistory(snapshotBefore);
    useSceneStore.getState().deleteNode("rect1");
    expect(useSceneStore.getState().nodesById["rect1"]).toBeUndefined();

    const undo = getCommands().find((c) => c.id === "edit-undo");
    undo!.run();

    expect(useSceneStore.getState().nodesById["rect1"]).toBeDefined();
  });

  it("running view-toggle-ui flips isUIHidden", () => {
    const toggleUi = getCommands().find((c) => c.id === "view-toggle-ui");
    const before = useUIVisibilityStore.getState().isUIHidden;
    toggleUi!.run();
    expect(useUIVisibilityStore.getState().isUIHidden).toBe(!before);
  });
});
