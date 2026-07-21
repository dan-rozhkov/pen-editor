import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { usePluginStore } from "@/store/pluginStore";
import { deletePlugin, getAllPlugins } from "@/utils/pluginDb";
import type { PenPlugin } from "@/lib/plugins/types";

function baseInput(overrides: Partial<PenPlugin> = {}) {
  return {
    name: "Rename layers",
    description: "Renames the selection sequentially.",
    code: "pen.notify('hi')",
    source: "ai" as const,
    ...overrides,
  };
}

beforeEach(async () => {
  const records = await getAllPlugins();
  await Promise.all(records.map((r) => deletePlugin(r.id)));
  usePluginStore.setState({ plugins: [], hydrated: false });
});

describe("pluginStore", () => {
  it("starts unhydrated and empty", () => {
    expect(usePluginStore.getState().hydrated).toBe(false);
    expect(usePluginStore.getState().plugins).toEqual([]);
  });

  it("init hydrates from pluginDb and is idempotent", async () => {
    const installed = await usePluginStore.getState().install(baseInput());
    // Simulate a reload: a fresh in-memory store, same underlying DB.
    usePluginStore.setState({ plugins: [], hydrated: false });

    await usePluginStore.getState().init();
    expect(usePluginStore.getState().hydrated).toBe(true);
    expect(usePluginStore.getState().plugins).toHaveLength(1);
    expect(usePluginStore.getState().plugins[0].id).toBe(installed.id);

    // Second call is a no-op even if the DB changed underneath.
    await deletePlugin(installed.id);
    await usePluginStore.getState().init();
    expect(usePluginStore.getState().plugins).toHaveLength(1);
  });

  it("install assigns an id and persists to pluginDb", async () => {
    const plugin = await usePluginStore.getState().install(baseInput());
    expect(plugin.id).toBeTruthy();
    expect(plugin.createdAt).toBeGreaterThan(0);
    expect(usePluginStore.getState().plugins).toHaveLength(1);

    const dbRecords = await getAllPlugins();
    expect(dbRecords).toHaveLength(1);
    expect(dbRecords[0].id).toBe(plugin.id);
  });

  it("install with a colliding id generates a fresh one instead of overwriting", async () => {
    const first = await usePluginStore.getState().install(baseInput({ id: "fixed-id" } as never));
    const second = await usePluginStore
      .getState()
      .install(baseInput({ id: "fixed-id", name: "Other" } as never));

    expect(second.id).not.toBe(first.id);
    expect(usePluginStore.getState().plugins).toHaveLength(2);
  });

  it("update patches fields and bumps updatedAt", async () => {
    const plugin = await usePluginStore.getState().install(baseInput());
    const before = plugin.updatedAt;

    await new Promise((r) => setTimeout(r, 2));
    await usePluginStore.getState().update(plugin.id, { code: "pen.notify('bye')" });

    const updated = usePluginStore.getState().plugins.find((p) => p.id === plugin.id);
    expect(updated?.code).toBe("pen.notify('bye')");
    expect(updated?.updatedAt).toBeGreaterThan(before);

    const dbRecords = await getAllPlugins();
    expect(dbRecords[0].code).toBe("pen.notify('bye')");
  });

  it("rename is sugar over update", async () => {
    const plugin = await usePluginStore.getState().install(baseInput());
    await usePluginStore.getState().rename(plugin.id, "Renamed");
    expect(usePluginStore.getState().plugins[0].name).toBe("Renamed");
  });

  it("remove deletes from the store and pluginDb", async () => {
    const plugin = await usePluginStore.getState().install(baseInput());
    await usePluginStore.getState().remove(plugin.id);

    expect(usePluginStore.getState().plugins).toEqual([]);
    expect(await getAllPlugins()).toEqual([]);
  });

  it("remove on an unknown id is a safe no-op", async () => {
    await expect(usePluginStore.getState().remove("nope")).resolves.toBeUndefined();
  });
});
