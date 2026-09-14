import { describe, it, expect, afterEach, vi } from "vitest";
import {
  canSendImages,
  getDefaultModel,
  getModelOptions,
  modelSupportsVision,
} from "@/lib/chatModels";

describe("chatModels fallback", () => {
  it("offers the shipped models before any /api/models response", () => {
    expect(getModelOptions().map((option) => option.value)).toEqual([
      "meta/muse-spark-1.3-contributor",
      "qwen/qwen3.8-flash",
      "z-ai/glm-5.3-flash",
      "deepseek/deepseek-v4.1-flash",
    ]);
    expect(getDefaultModel()).toBe("deepseek/deepseek-v4.1-flash");
  });

  it("allows images on every shipped model, all of which read them natively", () => {
    for (const option of getModelOptions()) {
      expect(modelSupportsVision(option.value)).toBe(true);
      expect(canSendImages(option.value)).toBe(true);
    }
  });

  // A stale saved selection, or a model the backend added after this bundle
  // was built: assumed vision-capable, matching the backend's own convention
  // for an id with no metadata.
  it("assumes an unknown model reads images", () => {
    expect(modelSupportsVision("who/knows")).toBe(true);
  });
});

describe("chatModels visionFallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("lets a vision-less backend model send images once it reports visionFallback: true", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          models: [
            {
              id: "text-only/model",
              label: "Text Only",
              supportsVision: false,
            },
          ],
          default: "text-only/model",
          visionFallback: true,
        }),
      })),
    );

    const fresh = await import("@/lib/chatModels");
    await fresh.loadModels();

    expect(fresh.getModelOptions().map((o) => o.value)).toEqual(["text-only/model"]);
    expect(fresh.getDefaultModel()).toBe("text-only/model");
    expect(fresh.modelSupportsVision("text-only/model")).toBe(false);
    expect(fresh.canSendImages("text-only/model")).toBe(true);
  });

  it("keeps the hardcoded fallback list when the fetch fails", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );

    const fresh = await import("@/lib/chatModels");
    await fresh.loadModels();

    expect(fresh.getDefaultModel()).toBe("deepseek/deepseek-v4.1-flash");
    expect(fresh.getModelOptions()).toHaveLength(4);
    expect(fresh.canSendImages("deepseek/deepseek-v4.1-flash")).toBe(true);
  });
});

describe("chatModels imageOps capabilities", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("default false before any /api/models response has landed", async () => {
    vi.resetModules();
    const fresh = await import("@/lib/chatModels");
    expect(fresh.canRemoveBackground()).toBe(false);
    expect(fresh.canVectorize()).toBe(false);
  });

  it("reflects the backend's imageOps flags once loaded", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          models: [{ id: "m", label: "M", supportsVision: true }],
          default: "m",
          visionFallback: false,
          imageOps: { removeBackground: true, vectorize: false },
        }),
      })),
    );

    const fresh = await import("@/lib/chatModels");
    await fresh.loadModels();

    expect(fresh.canRemoveBackground()).toBe(true);
    expect(fresh.canVectorize()).toBe(false);
  });

  it("stays false when the backend response omits imageOps", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          models: [{ id: "m", label: "M", supportsVision: true }],
          default: "m",
          visionFallback: false,
        }),
      })),
    );

    const fresh = await import("@/lib/chatModels");
    await fresh.loadModels();

    expect(fresh.canRemoveBackground()).toBe(false);
    expect(fresh.canVectorize()).toBe(false);
  });
});
