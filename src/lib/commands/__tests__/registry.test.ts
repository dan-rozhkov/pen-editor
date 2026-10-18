import { describe, it, expect, beforeEach, vi } from "vitest";

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));
vi.mock("@/lib/analytics", () => ({
  track: trackMock,
}));

import { resetStores, seedScene } from "@/test/fixtures";
import { getCommands, runCommand } from "../registry";
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
  trackMock.mockClear();
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

  it("flags every scene-mutating Edit command with mutatesScene", () => {
    const commands = getCommands();
    for (const id of ["edit-cut", "edit-paste", "edit-paste-properties", "edit-group", "edit-ungroup", "edit-delete"]) {
      const command = commands.find((c) => c.id === id);
      expect(command?.mutatesScene).toBe(true);
    }
    // Undo/redo must stay reachable in dev mode — never flagged.
    for (const id of ["edit-undo", "edit-redo"]) {
      const command = commands.find((c) => c.id === id);
      expect(command?.mutatesScene).toBeFalsy();
    }
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

describe("runCommand analytics", () => {
  it("emits editor_command_run once and document_exported once for a file-export command", () => {
    const runSpy = vi.fn();
    runCommand({ id: "file-export-json", label: "Export as .json", group: "File", run: runSpy });

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledTimes(2);
    expect(trackMock).toHaveBeenCalledWith("editor_command_run", { command_id: "file-export-json" });
    expect(trackMock).toHaveBeenCalledWith("document_exported", { format: "json" });
  });

  it("does not emit document_exported for a non-export command", () => {
    const runSpy = vi.fn();
    runCommand({ id: "edit-undo", label: "Undo", group: "Edit", run: runSpy });

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith("editor_command_run", { command_id: "edit-undo" });
  });

  it("emits document_exported exactly once when a File -> Export item runs through runCommand — no double count with the palette path", () => {
    // Same command object getCommands() (and therefore the palette) would
    // resolve; running it exactly the way the Toolbar's rerouted handlers
    // now do must not fire the export event twice.
    const command = getCommands().find((c) => c.id === "file-export-tokens")!;
    runCommand({ ...command, run: vi.fn() });

    expect(trackMock.mock.calls.filter(([event]) => event === "document_exported")).toHaveLength(1);
    expect(trackMock).toHaveBeenCalledWith("document_exported", { format: "tokens" });
  });
});
