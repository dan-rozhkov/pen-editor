import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { deletePlugin, getAllPlugins, putPlugin } from "@/utils/pluginDb";
import type { PenPlugin } from "@/lib/plugins/types";

function makePlugin(overrides: Partial<PenPlugin> = {}): PenPlugin {
  return {
    id: "plugin-1",
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
});

describe("pluginDb", () => {
  it("starts empty", async () => {
    expect(await getAllPlugins()).toEqual([]);
  });

  it("round-trips a stored plugin record", async () => {
    await putPlugin(makePlugin());

    const records = await getAllPlugins();
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(makePlugin());
  });

  it("overwrites the record for an id that's re-installed (keyPath dedup)", async () => {
    await putPlugin(makePlugin({ name: "v1" }));
    await putPlugin(makePlugin({ name: "v2", updatedAt: 2 }));

    const records = await getAllPlugins();
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe("v2");
  });

  it("deletes a record by id", async () => {
    await putPlugin(makePlugin());
    await deletePlugin("plugin-1");
    expect(await getAllPlugins()).toEqual([]);
  });

  it("stores distinct ids independently", async () => {
    await putPlugin(makePlugin({ id: "plugin-1" }));
    await putPlugin(makePlugin({ id: "plugin-2", name: "Other" }));

    const records = await getAllPlugins();
    expect(records).toHaveLength(2);
  });
});
