import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addByokModel,
  BYOK_PRESETS,
  byokModelValue,
  clearByokConfig,
  getByokConfig,
  isByokConfigured,
  isHeaderSafe,
  normalizeByokBaseUrl,
  normalizeByokModels,
  isByokModel,
  removeByokModel,
  setByokConnection,
  subscribeByok,
} from "@/lib/byokProvider";

// Writes bypassing the module are picked up on the storage event, as in a second tab.
function writeExternally(value: string): void {
  localStorage.setItem("pen.byok.v1", value);
  window.dispatchEvent(new StorageEvent("storage", { key: "pen.byok.v1" }));
}

afterEach(() => {
  vi.restoreAllMocks();
  clearByokConfig();
});

describe("byokProvider storage", () => {
  it("is empty and unconfigured by default", () => {
    expect(getByokConfig()).toEqual({ baseUrl: "", apiKey: "", models: [] });
    expect(isByokConfigured()).toBe(false);
  });

  it("saves a trimmed connection and returns a stable snapshot", () => {
    setByokConnection("  https://api.example.com/v1 ", " sk-x ");
    const a = getByokConfig();
    expect(a.baseUrl).toBe("https://api.example.com/v1");
    expect(a.apiKey).toBe("sk-x");
    expect(isByokConfigured()).toBe(true);
    expect(getByokConfig()).toBe(a);
  });

  it("adds models without duplicates or blanks and removes them", () => {
    addByokModel({ id: " gpt-4.1 " });
    addByokModel({ id: "gpt-4.1" });
    addByokModel({ id: "  " });
    addByokModel({ id: "org/model", contextWindow: 8000 });
    expect(getByokConfig().models).toEqual([{ id: "gpt-4.1" }, { id: "org/model", contextWindow: 8000 }]);
    removeByokModel("gpt-4.1");
    expect(getByokConfig().models).toEqual([{ id: "org/model", contextWindow: 8000 }]);
  });

  it("keeps models on a key-only change, drops them when the base URL changes, and clears on clear", () => {
    setByokConnection("https://a/v1", "k");
    addByokModel({ id: "m" });
    setByokConnection("https://a/v1", "k2");
    expect(getByokConfig().models).toEqual([{ id: "m" }]);
    setByokConnection("https://b/v1", "k2");
    expect(getByokConfig().models).toEqual([]);
    clearByokConfig();
    expect(getByokConfig()).toEqual({ baseUrl: "", apiKey: "", models: [] });
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const cb = vi.fn();
    const off = subscribeByok(cb);
    setByokConnection("https://a/v1", "k");
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    clearByokConfig();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("treats bad JSON and wrong shapes as empty", () => {
    writeExternally("{not json");
    expect(getByokConfig().models).toEqual([]);
    expect(isByokConfigured()).toBe(false);
    writeExternally(JSON.stringify([1, 2]));
    expect(getByokConfig().apiKey).toBe("");
    writeExternally(
      JSON.stringify({ baseUrl: 5, apiKey: "k", models: [{ id: 3 }, null, { id: "ok", contextWindow: "x" }, { id: "ok" }] }),
    );
    expect(getByokConfig()).toEqual({ baseUrl: "", apiKey: "k", models: [{ id: "ok" }] });
  });

  it("never throws when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => getByokConfig()).not.toThrow();
    expect(() => setByokConnection("https://a/v1", "k")).not.toThrow();
    expect(() => addByokModel({ id: "m" })).not.toThrow();
    expect(() => clearByokConfig()).not.toThrow();
    expect(isByokConfigured()).toBe(false);
  });

  it("recognises byok model values and exposes presets", () => {
    expect(isByokModel("byok/org/model")).toBe(true);
    expect(isByokModel("opencode/x")).toBe(false);
    expect(byokModelValue("org/model")).toBe("byok/org/model");
    expect(BYOK_PRESETS.map((p) => p.id)).toEqual([
      "openai",
      "openrouter",
      "groq",
      "deepseek",
      "together",
      "mistral",
      "custom",
    ]);
  });

  it("normalizes model lists: trims, drops blanks and duplicates, keeps positive numeric windows", () => {
    expect(normalizeByokModels("x")).toEqual([]);
    expect(
      normalizeByokModels([
        { id: " a ", contextWindow: 100 },
        { id: "a" },
        { id: "  " },
        { id: "b", contextWindow: -1 },
        { id: "c", contextWindow: "9" },
        null,
        { id: 4 },
      ]),
    ).toEqual([{ id: "a", contextWindow: 100 }, { id: "b" }, { id: "c" }]);
  });

  it("serves the cached config until notify, then re-reads storage", () => {
    setByokConnection("https://a/v1", "k");
    const first = getByokConfig();
    // A write that bypasses the module and sends no storage event is not seen:
    // proof that getByokConfig does not hit localStorage on every call.
    localStorage.setItem("pen.byok.v1", JSON.stringify({ baseUrl: "https://b/v1", apiKey: "k2", models: [] }));
    expect(getByokConfig()).toBe(first);
    window.dispatchEvent(new StorageEvent("storage", { key: "pen.byok.v1" }));
    expect(getByokConfig().baseUrl).toBe("https://b/v1");
  });
});

describe("normalizeByokBaseUrl", () => {
  it.each([
    ["https://api.example.com/v1", "https://api.example.com/v1"],
    ["  https://api.example.com/v1/  ", "https://api.example.com/v1"],
    ["https://api.example.com", "https://api.example.com"],
    ["http://localhost:8080/v1", "http://localhost:8080/v1"],
    ["http://127.0.0.1:11434/v1", "http://127.0.0.1:11434/v1"],
    ["http://[::1]:8000/v1", "http://[::1]:8000/v1"],
    ["https://bücher.example/v1", "https://xn--bcher-kva.example/v1"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeByokBaseUrl(input)).toBe(expected);
  });

  it.each([
    "",
    "api.example.com/v1",
    "http://api.example.com/v1",
    "ftp://api.example.com",
    "https://user:pw@api.example.com/v1",
    "https://api.example.com/v1?x=1",
    "https://api.example.com/v1#frag",
  ])("rejects %j", (input) => {
    expect(normalizeByokBaseUrl(input)).toBeNull();
  });
});

describe("isHeaderSafe", () => {
  it("accepts visible ASCII only", () => {
    expect(isHeaderSafe("sk-abc_123.XYZ")).toBe(true);
    expect(isHeaderSafe("")).toBe(false);
    expect(isHeaderSafe("sk with space")).toBe(false);
    expect(isHeaderSafe("sk-ключ")).toBe(false);
    expect(isHeaderSafe("sk-a\nb")).toBe(false);
  });
});
