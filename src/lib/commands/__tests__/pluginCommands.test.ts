import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePluginStore } from "@/store/pluginStore";
import { usePluginManagerStore } from "@/store/pluginManagerStore";
import type { PenPlugin } from "@/lib/plugins/types";

const runPlugin = vi.fn();
vi.mock("@/lib/plugins/pluginHost", () => ({
  runPlugin: (plugin: PenPlugin) => runPlugin(plugin),
  stopPlugin: vi.fn(),
}));

// Imported after the mock so pluginCommands picks up the mocked runPlugin.
const { getPluginCommands } = await import("@/lib/commands/pluginCommands");

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

beforeEach(() => {
  usePluginStore.setState({ plugins: [], hydrated: true });
  usePluginManagerStore.setState({ open: false });
  runPlugin.mockClear();
});

describe("getPluginCommands", () => {
  it("returns only the manage command when no plugins are installed", () => {
    const commands = getPluginCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe("plugins-manage");
    expect(commands[0].group).toBe("Plugins");
    expect(commands[0].mutatesScene).toBeUndefined();
  });

  it("emits one run command per installed plugin, flagged mutatesScene", () => {
    usePluginStore.setState({
      plugins: [makePlugin({ id: "p1", name: "Alpha" }), makePlugin({ id: "p2", name: "Beta", icon: "✨" })],
      hydrated: true,
    });

    const commands = getPluginCommands();
    const runCommands = commands.filter((c) => c.id !== "plugins-manage");
    expect(runCommands).toHaveLength(2);
    expect(runCommands.every((c) => c.mutatesScene)).toBe(true);
    expect(runCommands.every((c) => c.group === "Plugins")).toBe(true);
    expect(runCommands.find((c) => c.id === "plugin-p2")?.label).toBe("✨ Beta");
    expect(runCommands.find((c) => c.id === "plugin-p1")?.label).toBe("Alpha");
  });

  it("running a plugin command dispatches to runPlugin with the plugin record", () => {
    const plugin = makePlugin();
    usePluginStore.setState({ plugins: [plugin], hydrated: true });

    const commands = getPluginCommands();
    commands.find((c) => c.id === "plugin-p1")?.run();

    expect(runPlugin).toHaveBeenCalledWith(plugin);
  });

  it("the manage command opens the plugin manager panel", () => {
    const commands = getPluginCommands();
    commands.find((c) => c.id === "plugins-manage")?.run();
    expect(usePluginManagerStore.getState().open).toBe(true);
  });
});
