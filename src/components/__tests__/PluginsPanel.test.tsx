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
    expect(screen.getByText("No plugins installed yet")).toBeTruthy();
    expect(screen.getByTestId("plugins-empty-state-icon")).toBeTruthy();
  });

  it("lists installed plugins with name and description", () => {
    usePluginStore.setState({ plugins: [makePlugin()], hydrated: true });
    render(<PluginsPanel />);
    expect(screen.getByText("Rename layers")).toBeTruthy();
    expect(screen.getByText("Renames the selection sequentially.")).toBeTruthy();
  });

  it("filters plugins by name and description on the client", () => {
    usePluginStore.setState({
      plugins: [
        makePlugin(),
        makePlugin({ id: "p2", name: "Generate palette", description: "Creates a color palette." }),
      ],
      hydrated: true,
    });
    render(<PluginsPanel />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search plugins" }), {
      target: { value: "color" },
    });

    expect(screen.queryByText("Rename layers")).toBeNull();
    expect(screen.getByText("Generate palette")).toBeTruthy();
  });

  it("clicking a plugin card dispatches to runPlugin", () => {
    const plugin = makePlugin();
    usePluginStore.setState({ plugins: [plugin], hydrated: true });
    render(<PluginsPanel />);
    fireEvent.click(screen.getByTestId("plugin-card-p1"));
    expect(runPlugin).toHaveBeenCalledWith(plugin);
  });

  it("does not run a plugin card in Dev Mode", () => {
    const plugin = makePlugin();
    usePluginStore.setState({ plugins: [plugin], hydrated: true });
    useDevModeStore.setState({ active: true });
    render(<PluginsPanel />);

    fireEvent.click(screen.getByTestId("plugin-card-p1"));
    expect(runPlugin).not.toHaveBeenCalled();
  });

  it("does not run a plugin card in view mode", () => {
    const plugin = makePlugin();
    usePluginStore.setState({ plugins: [plugin], hydrated: true });
    render(
      <ReadOnlyContext.Provider value={true}>
        <PluginsPanel />
      </ReadOnlyContext.Provider>,
    );

    fireEvent.click(screen.getByTestId("plugin-card-p1"));
    expect(runPlugin).not.toHaveBeenCalled();
  });

  it("Delete requires confirmation, then removes the plugin from the store and pluginDb", async () => {
    const plugin = makePlugin();
    usePluginStore.setState({ plugins: [plugin], hydrated: true });
    render(<PluginsPanel />);

    // Opens the confirm dialog; the plugin isn't removed yet.
    fireEvent.click(screen.getByRole("button", { name: "Plugin options" }));
    fireEvent.click(screen.getByText("Delete"));
    expect(usePluginStore.getState().plugins).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

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
