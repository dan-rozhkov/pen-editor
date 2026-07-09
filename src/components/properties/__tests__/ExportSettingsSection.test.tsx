import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ExportSettingsSection } from "../ExportSettingsSection";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useExportPresetStore } from "@/store/exportPresetStore";
import type { SceneNode } from "@/types/scene";

function makeNode(extra: Partial<SceneNode> = {}): SceneNode {
  return {
    id: "n1",
    type: "rect",
    name: "My Box",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...extra,
  } as SceneNode;
}

beforeEach(() => {
  useCanvasRefStore.setState({ pixiRefs: null });
  useExportPresetStore.setState({ presets: [] });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<ExportSettingsSection />", () => {
  it("renders the section with no rows and no Export all button when there are no settings", () => {
    render(<ExportSettingsSection node={makeNode()} onUpdate={vi.fn()} />);
    expect(screen.getByText("Export settings")).toBeTruthy();
    expect(screen.queryByText("Export all")).toBeNull();
  });

  it("adding a row calls onUpdate with a new exportSettings array", () => {
    const onUpdate = vi.fn();
    render(<ExportSettingsSection node={makeNode()} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByTitle("Add export setting"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const call = onUpdate.mock.calls[0][0];
    expect(call.exportSettings).toHaveLength(1);
    expect(call.exportSettings[0]).toMatchObject({ format: "png", scale: 1 });
  });

  it("renders one row per existing exportSetting and an Export all button", () => {
    const node = makeNode({
      exportSettings: [
        { id: "a", format: "png", scale: 1 },
        { id: "b", format: "svg", scale: 2 },
      ],
    });
    render(<ExportSettingsSection node={node} onUpdate={vi.fn()} />);

    expect(screen.getByTestId("export-settings-list").children).toHaveLength(2);
    expect(screen.getByText("Export all")).toBeTruthy();
  });

  it("removing a row calls onUpdate with that setting filtered out", () => {
    const onUpdate = vi.fn();
    const node = makeNode({
      exportSettings: [
        { id: "a", format: "png", scale: 1 },
        { id: "b", format: "svg", scale: 2 },
      ],
    });
    render(<ExportSettingsSection node={node} onUpdate={onUpdate} />);

    const removeButtons = screen.getAllByTitle("Remove export setting");
    fireEvent.click(removeButtons[0]);

    expect(onUpdate).toHaveBeenCalledWith({
      exportSettings: [{ id: "b", format: "svg", scale: 2 }],
    });
  });

  it("editing the suffix input updates the matching setting", () => {
    const onUpdate = vi.fn();
    const node = makeNode({ exportSettings: [{ id: "a", format: "png", scale: 1 }] });
    render(<ExportSettingsSection node={node} onUpdate={onUpdate} />);

    fireEvent.change(screen.getByPlaceholderText("@2x, _dark, ..."), {
      target: { value: "@2x" },
    });

    expect(onUpdate).toHaveBeenCalledWith({
      exportSettings: [{ id: "a", format: "png", scale: 1, suffix: "@2x" }],
    });
  });

  it("keeps each row's 'Save as preset' name independent and saves the right row's config", () => {
    const node = makeNode({
      exportSettings: [
        { id: "a", format: "png", scale: 2 },
        { id: "b", format: "svg", scale: 1 },
      ],
    });
    render(<ExportSettingsSection node={node} onUpdate={vi.fn()} />);

    const presetInputs = screen.getAllByPlaceholderText("Preset name");
    expect(presetInputs).toHaveLength(2);

    // Type only into the first row's field — the second row must stay empty.
    fireEvent.change(presetInputs[0], { target: { value: "PNG 2x" } });
    expect((presetInputs[0] as HTMLInputElement).value).toBe("PNG 2x");
    expect((presetInputs[1] as HTMLInputElement).value).toBe("");

    // Saving the first row persists that row's format/scale under its own name.
    const saveButtons = screen.getAllByText("Save");
    fireEvent.click(saveButtons[0]);

    const presets = useExportPresetStore.getState().presets;
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({ name: "PNG 2x", format: "png", scale: 2 });
  });

  it("skips Export all when there are no pixi refs and no settings need pixi (svg only) — no crash", async () => {
    const node = makeNode({ exportSettings: [{ id: "a", format: "svg", scale: 1 }] });
    render(<ExportSettingsSection node={node} onUpdate={vi.fn()} />);

    fireEvent.click(screen.getByText("Export all"));
    // handleExportAll is async; flush microtasks so the status text settles.
    await Promise.resolve();
    await Promise.resolve();
  });
});
