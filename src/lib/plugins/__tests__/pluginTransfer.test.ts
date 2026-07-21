import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportPluginToFile, parsePluginImport } from "@/lib/plugins/pluginTransfer";
import type { PenPlugin } from "@/lib/plugins/types";

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

describe("parsePluginImport", () => {
  it("rejects text that isn't valid JSON", () => {
    expect(parsePluginImport("{not json")).toEqual({ ok: false, reason: "invalid-json" });
  });

  it("rejects JSON that doesn't look like a plugin export", () => {
    expect(parsePluginImport(JSON.stringify({ name: "X" }))).toEqual({
      ok: false,
      reason: "invalid-shape",
    });
  });

  it("parses a valid export into install input, marking it imported", () => {
    const plugin = makePlugin();
    const result = parsePluginImport(JSON.stringify(plugin));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.input).toEqual({
      name: plugin.name,
      description: plugin.description,
      code: plugin.code,
      icon: undefined,
      ui: undefined,
      source: "imported",
      id: plugin.id,
    });
  });

  it("round-trips an id-less export (a fresh id is assigned downstream by install)", () => {
    const plugin = makePlugin();
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, source: _source, ...withoutId } = plugin;
    const result = parsePluginImport(JSON.stringify(withoutId));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.input.id).toBeUndefined();
  });
});

describe("exportPluginToFile", () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("triggers a download named after the sanitized plugin name", () => {
    exportPluginToFile(makePlugin({ name: "Rename Layers!" }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("rename-layers.json");
  });
});
