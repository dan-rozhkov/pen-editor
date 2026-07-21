import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { usePluginStore } from "@/store/pluginStore";
import { deletePlugin, getAllPlugins } from "@/utils/pluginDb";
import { createPlugin } from "../createPlugin";
import { updatePlugin } from "../updatePlugin";
import { MAX_PLUGIN_CODE_LENGTH } from "../shared";

beforeEach(async () => {
  const records = await getAllPlugins();
  await Promise.all(records.map((r) => deletePlugin(r.id)));
  usePluginStore.setState({ plugins: [], hydrated: false });
});

async function installOne() {
  await createPlugin({ name: "Original", description: "d", code: "c" });
  return usePluginStore.getState().plugins[0];
}

describe("update_plugin handler", () => {
  it("errors when id is missing", async () => {
    const result = await updatePlugin({ name: "New" });
    expect(JSON.parse(result)).toEqual({ error: "id is required" });
  });

  it("errors when the id doesn't resolve to an installed plugin", async () => {
    const result = await updatePlugin({ id: "nope", name: "New" });
    expect(JSON.parse(result).error).toContain('no plugin with id "nope"');
  });

  it("updates name and returns a confirmation string", async () => {
    const plugin = await installOne();
    const result = await updatePlugin({ id: plugin.id, name: "Renamed" });
    expect(result).toBe(`plugin updated: ${plugin.id} "Renamed".`);
    expect(usePluginStore.getState().plugins[0].name).toBe("Renamed");
  });

  it("updates only the fields provided, leaving the rest untouched", async () => {
    const plugin = await installOne();
    await updatePlugin({ id: plugin.id, code: "new code" });
    const updated = usePluginStore.getState().plugins[0];
    expect(updated.code).toBe("new code");
    expect(updated.name).toBe("Original");
    expect(updated.description).toBe("d");
  });

  it("persists the update to IndexedDB", async () => {
    const plugin = await installOne();
    await updatePlugin({ id: plugin.id, code: "persisted" });
    const dbRecords = await getAllPlugins();
    expect(dbRecords.find((r) => r.id === plugin.id)?.code).toBe("persisted");
  });

  it("can set ui to a valid object, or clear it to null (headless)", async () => {
    const plugin = await installOne();
    await updatePlugin({ id: plugin.id, ui: { width: 300, height: 200 } });
    expect(usePluginStore.getState().plugins[0].ui).toEqual({ width: 300, height: 200 });

    await updatePlugin({ id: plugin.id, ui: null });
    expect(usePluginStore.getState().plugins[0].ui).toBeNull();
  });

  it("rejects empty-string name/description/code without mutating the plugin", async () => {
    const plugin = await installOne();

    expect(JSON.parse(await updatePlugin({ id: plugin.id, name: "" })).error).toContain(
      "non-empty",
    );
    expect(
      JSON.parse(await updatePlugin({ id: plugin.id, description: "" })).error,
    ).toContain("non-empty");
    expect(JSON.parse(await updatePlugin({ id: plugin.id, code: "" })).error).toContain(
      "non-empty",
    );

    expect(usePluginStore.getState().plugins[0]).toMatchObject({
      name: "Original",
      description: "d",
      code: "c",
    });
  });

  it("rejects code over the 100 KB limit", async () => {
    const plugin = await installOne();
    const oversized = "a".repeat(MAX_PLUGIN_CODE_LENGTH + 1);
    const result = await updatePlugin({ id: plugin.id, code: oversized });
    expect(JSON.parse(result).error).toContain("too long");
  });

  it("rejects a malformed ui", async () => {
    const plugin = await installOne();
    const result = await updatePlugin({ id: plugin.id, ui: { width: 100 } });
    expect(JSON.parse(result).error).toContain("ui must be");
  });

  it("errors when no patch fields are provided", async () => {
    const plugin = await installOne();
    const result = await updatePlugin({ id: plugin.id });
    expect(JSON.parse(result).error).toContain("no fields to update");
  });
});
