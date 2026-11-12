import { afterEach, describe, expect, it, vi } from "vitest";
import { addByokModel, clearByokConfig, setByokConnection } from "@/lib/byokProvider";
import { canSendImages, canUseModel, getModelContextWindow, getModelOptions, modelSupportsVision, subscribeModels } from "@/lib/chatModels";

afterEach(() => clearByokConfig());

describe("chatModels with own-key models", () => {
  it("returns the backend list untouched when no model is added", () => {
    expect(getModelOptions().some((o) => o.byok)).toBe(false);
  });

  it("appends own-key models with a label, no vision and a stable array", () => {
    setByokConnection("https://api.example.com/v1", "k");
    addByokModel({ id: "org/m1", contextWindow: 32000 });
    const options = getModelOptions();
    const entry = options.find((o) => o.value === "byok/org/m1");
    expect(entry).toEqual({
      value: "byok/org/m1",
      label: "org/m1 · Own key",
      supportsVision: false,
      byok: true,
      contextWindow: 32000,
    });
    expect(getModelOptions()).toBe(options);
  });

  it("canUseModel needs a configured connection and a listed model", () => {
    setByokConnection("https://api.example.com/v1", "");
    addByokModel({ id: "m" });
    expect(canUseModel("byok/m")).toBe(false);
    setByokConnection("https://api.example.com/v1", "k");
    expect(canUseModel("byok/m")).toBe(true);
    expect(canUseModel("byok/other")).toBe(false);
  });

  it("reports no native vision, the context window, and follows visionFallback for images", () => {
    setByokConnection("https://api.example.com/v1", "k");
    addByokModel({ id: "m", contextWindow: 1000 });
    addByokModel({ id: "n" });
    expect(modelSupportsVision("byok/m")).toBe(false);
    expect(modelSupportsVision("byok/unlisted")).toBe(false);
    expect(getModelContextWindow("byok/m")).toBe(1000);
    expect(getModelContextWindow("byok/n")).toBeUndefined();
    expect(canSendImages("byok/m")).toBe(false);
  });

  it("notifies model subscribers when the byok config changes", () => {
    const cb = vi.fn();
    const off = subscribeModels(cb);
    addByokModel({ id: "m" });
    expect(cb).toHaveBeenCalled();
    off();
  });
});
