import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { usePluginStore } from "@/store/pluginStore";
import { createPlugin } from "../createPlugin";
import { listPlugins } from "../listPlugins";
import { resetPluginTestState } from "./testUtils";

beforeEach(resetPluginTestState);

describe("list_plugins handler", () => {
  it("returns 'no plugins installed' when empty", async () => {
    const result = await listPlugins({});
    expect(result).toBe("no plugins installed");
  });

  it("returns a compact {id, name, description} list", async () => {
    await createPlugin({ name: "A", description: "Does A.", code: "c1" });
    await createPlugin({ name: "B", description: "Does B.", code: "c2" });

    const result = await listPlugins({});
    const parsed = JSON.parse(result) as Array<{
      id: string;
      name: string;
      description: string;
    }>;
    expect(parsed).toHaveLength(2);
    expect(parsed.map((p) => p.name).sort()).toEqual(["A", "B"]);
    // No code/ui/timestamps leaked into the compact listing.
    for (const item of parsed) {
      expect(Object.keys(item).sort()).toEqual(["description", "id", "name"]);
    }
  });

  it("hydrates from IndexedDB even if the in-memory store hasn't loaded yet", async () => {
    // Simulate a plugin persisted in an earlier session that this fresh
    // in-memory store instance hasn't read yet.
    await createPlugin({ name: "Persisted", description: "d", code: "c" });
    usePluginStore.setState({ plugins: [], hydrated: false });

    const result = await listPlugins({});
    const parsed = JSON.parse(result) as Array<{ name: string }>;
    expect(parsed.map((p) => p.name)).toEqual(["Persisted"]);
  });
});
