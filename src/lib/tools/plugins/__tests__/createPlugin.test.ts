import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { usePluginStore } from "@/store/pluginStore";
import { getAllPlugins } from "@/utils/pluginDb";
import { createPlugin } from "../createPlugin";
import { MAX_PLUGIN_CODE_LENGTH } from "../shared";
import { resetPluginTestState } from "./testUtils";

beforeEach(resetPluginTestState);

describe("create_plugin handler", () => {
  it("installs a headless plugin (ui absent) and returns a confirmation string", async () => {
    const result = await createPlugin({
      name: "Sequential rename",
      description: "Renames the selection sequentially.",
      code: "pen.notify('hi')",
    });

    expect(result).toMatch(/^plugin installed: .+ "Sequential rename"\. User can run it/);

    const plugins = usePluginStore.getState().plugins;
    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      name: "Sequential rename",
      description: "Renames the selection sequentially.",
      code: "pen.notify('hi')",
      ui: null,
      source: "ai",
    });

    // Persisted to IndexedDB, not just in-memory.
    const dbRecords = await getAllPlugins();
    expect(dbRecords).toHaveLength(1);
  });

  it("installs a UI plugin when ui is a valid {width, height}", async () => {
    await createPlugin({
      name: "Counter",
      description: "A small persistent counter.",
      code: "pen.notify('hi')",
      ui: { width: 200, height: 120 },
    });

    expect(usePluginStore.getState().plugins[0].ui).toEqual({ width: 200, height: 120 });
  });

  it("stores an icon when provided", async () => {
    await createPlugin({
      name: "Counter",
      description: "d",
      code: "c",
      icon: "🔢",
    });
    expect(usePluginStore.getState().plugins[0].icon).toBe("🔢");
  });

  it("accepts and stores the literal icon string \"invalid\" (no sentinel collision)", async () => {
    const result = await createPlugin({
      name: "Counter",
      description: "d",
      code: "c",
      icon: "invalid",
    });
    expect(result).toContain("plugin installed");
    expect(usePluginStore.getState().plugins[0].icon).toBe("invalid");
  });

  it("trims name/description", async () => {
    await createPlugin({ name: "  Padded  ", description: "  d  ", code: "c" });
    expect(usePluginStore.getState().plugins[0].name).toBe("Padded");
    expect(usePluginStore.getState().plugins[0].description).toBe("d");
  });

  it("rejects a missing name/description/code with a clear error, no install", async () => {
    const noName = await createPlugin({ description: "d", code: "c" });
    expect(JSON.parse(noName)).toEqual({ error: "name is required" });

    const noDescription = await createPlugin({ name: "n", code: "c" });
    expect(JSON.parse(noDescription)).toEqual({ error: "description is required" });

    const noCode = await createPlugin({ name: "n", description: "d" });
    expect(JSON.parse(noCode)).toEqual({ error: "code is required" });

    expect(usePluginStore.getState().plugins).toHaveLength(0);
  });

  it("rejects code over the 100 KB limit", async () => {
    const oversized = "a".repeat(MAX_PLUGIN_CODE_LENGTH + 1);
    const result = await createPlugin({ name: "n", description: "d", code: oversized });
    const parsed = JSON.parse(result) as { error: string };
    expect(parsed.error).toContain("too long");
    expect(usePluginStore.getState().plugins).toHaveLength(0);
  });

  it("accepts code at exactly the 100 KB limit", async () => {
    const exact = "a".repeat(MAX_PLUGIN_CODE_LENGTH);
    const result = await createPlugin({ name: "n", description: "d", code: exact });
    expect(result).toContain("plugin installed");
  });

  it("rejects a malformed ui without installing", async () => {
    const result = await createPlugin({
      name: "n",
      description: "d",
      code: "c",
      ui: { width: 200 },
    });
    const parsed = JSON.parse(result) as { error: string };
    expect(parsed.error).toContain("ui must be");
    expect(usePluginStore.getState().plugins).toHaveLength(0);
  });
});
