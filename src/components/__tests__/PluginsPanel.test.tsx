import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { usePluginStore } from "@/store/pluginStore";
import { useDevModeStore } from "@/store/devModeStore";
import { ReadOnlyContext } from "@/hooks/useReadOnly";
import { deletePlugin, getAllPlugins } from "@/utils/pluginDb";
import type { PenPlugin } from "@/lib/plugins/types";

const runPlugin = vi.fn();
vi.mock("@/lib/plugins/pluginHost", () => ({
  runPlugin: (plugin: PenPlugin) => runPlugin(plugin),
  stopPlugin: vi.fn(),
}));

const { PluginsPanel } = await import("../PluginsPanel");

function makePlugin(overrides: Partial<PenPlugin> = {}): PenPlugin {
  return {
    id: "p1",
    name: "Rename layers",
    description: "Renames the selection sequentially.",
    code: "pen.notify('hi')",
    source: "ai",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(async () => {
  const records = await getAllPlugins();
  await Promise.all(records.map((r) => deletePlugin(r.id)));
  usePluginStore.setState({ plugins: [], hydrated: true });
  useDevModeStore.setState({ active: false });
  runPlugin.mockClear();
});

afterEach(() => cleanup());

describe("<PluginsPanel />", () => {
  it("shows an empty state with no plugins installed", () => {
    render(<PluginsPanel />);
    expect(screen.getByText(/no plugins installed/i)).toBeTruthy();
  });

  it("lists installed plugins with name and description", () => {
    usePluginStore.setState({ plugins: [makePlugin()], hydrated: true });
    render(<PluginsPanel />);
    expect(screen.getByText("Rename layers")).toBeTruthy();
    expect(screen.getByText("Renames the selection sequentially.")).toBeTruthy();
  });

  it("Run dispatches to runPlugin", () => {
    const plugin = makePlugin();
    usePluginStore.setState({ plugins: [plugin], hydrated: true });
    render(<PluginsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(runPlugin).toHaveBeenCalledWith(plugin);
  });

  it("disables Run in Dev Mode and does not dispatch to runPlugin", () => {
    const plugin = makePlugin();
    usePluginStore.setState({ plugins: [plugin], hydrated: true });
    useDevModeStore.setState({ active: true });
    render(<PluginsPanel />);

    const runButton = screen.getByRole("button", { name: "Run" }) as HTMLButtonElement;
    expect(runButton.disabled).toBe(true);

    fireEvent.click(runButton);
    expect(runPlugin).not.toHaveBeenCalled();
  });

  it("disables Run in view mode (read-only) and does not dispatch to runPlugin", () => {
    const plugin = makePlugin();
    usePluginStore.setState({ plugins: [plugin], hydrated: true });
    render(
      <ReadOnlyContext.Provider value={true}>
        <PluginsPanel />
      </ReadOnlyContext.Provider>,
    );

    const runButton = screen.getByRole("button", { name: "Run" }) as HTMLButtonElement;
    expect(runButton.disabled).toBe(true);

    fireEvent.click(runButton);
    expect(runPlugin).not.toHaveBeenCalled();
  });

  it("View code opens a read-only view with the plugin's code", () => {
    usePluginStore.setState({ plugins: [makePlugin()], hydrated: true });
    render(<PluginsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "View code" }));
    const textarea = screen.getByDisplayValue("pen.notify('hi')") as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);
  });

  it("Delete requires confirmation, then removes the plugin from the store and pluginDb", async () => {
    const plugin = makePlugin();
    usePluginStore.setState({ plugins: [plugin], hydrated: true });
    render(<PluginsPanel />);

    // Opens the confirm dialog; the plugin isn't removed yet.
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(usePluginStore.getState().plugins).toHaveLength(1);

    // Two "Delete" buttons now exist (the row action + the dialog's confirm
    // action) — the confirm action is the last one rendered.
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    await waitFor(() => expect(usePluginStore.getState().plugins).toHaveLength(0));
    expect(await getAllPlugins()).toEqual([]);
  });

  it("rename commits through EditableText", async () => {
    const plugin = makePlugin();
    usePluginStore.setState({ plugins: [plugin], hydrated: true });
    render(<PluginsPanel />);

    fireEvent.click(screen.getByText("Rename layers"));
    const input = screen.getByDisplayValue("Rename layers");
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.blur(input);

    await waitFor(() => expect(usePluginStore.getState().plugins[0].name).toBe("New name"));
  });
});
