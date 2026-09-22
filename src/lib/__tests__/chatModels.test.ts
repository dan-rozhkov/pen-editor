import { describe, it, expect, afterEach, vi } from "vitest";
import {
  canSendImages,
  canUseModel,
  getDefaultModel,
  getModelContextWindow,
  getModelOptions,
  modelSupportsVision,
} from "@/lib/chatModels";
import { clearOpenCodeKey, setOpenCodeKey } from "@/lib/opencodeKey";

afterEach(() => {
  clearOpenCodeKey();
});

describe("chatModels fallback", () => {
  it("offers the shipped models before any /api/models response", () => {
    expect(getModelOptions().map((option) => option.value)).toEqual([
      "meta/muse-spark-1.3-contributor",
      "qwen/qwen3.8-flash",
      "z-ai/glm-5.3-flash",
      "deepseek/deepseek-v4.1-flash",
      "google/gemini-3.8-flash",
      "tencent/hy4-preview",
      "z-ai/glm-5.3",
      "openai/gpt-6-luna",
      "z-ai/glm-5.2",
      "minimax/minimax-m3",
      "xiaomi/mimo-v2.6-pro",
      "xiaomi/mimo-v2.6-flash",
      "opencode-go/deepseek-v4.1-flash",
      "opencode-go/deepseek-v4-flash-vision-exp",
      "opencode-go/glm-5.3-flash",
      "opencode-go/glm-5.3",
      "opencode-go/glm-5.2",
      "opencode/deepseek-v4-flash",
      "opencode/glm-5.3-flash",
      "opencode/kimi-k2.7-code",
      "opencode/minimax-m3",
    ]);
    expect(getDefaultModel()).toBe("deepseek/deepseek-v4.1-flash");
  });

  it("marks exactly the nine OpenCode BYOK entries as requiresUserKey", () => {
    const requiresKey = getModelOptions()
      .filter((option) => option.requiresUserKey)
      .map((option) => option.value);
    expect(requiresKey).toEqual([
      "opencode-go/deepseek-v4.1-flash",
      "opencode-go/deepseek-v4-flash-vision-exp",
      "opencode-go/glm-5.3-flash",
      "opencode-go/glm-5.3",
      "opencode-go/glm-5.2",
      "opencode/deepseek-v4-flash",
      "opencode/glm-5.3-flash",
      "opencode/kimi-k2.7-code",
      "opencode/minimax-m3",
    ]);
  });

  // Not every shipped model reads images, and without a backend vision
  // fallback canSendImages() must follow that flag. The three OpenCode
  // entries here answered a test image with an EMPTY completion 3/3 when
  // measured live (2026-09-18) — see the comment above DEFAULT_MODELS in
  // pen-editor-backend/src/config.ts. Vision on that route is an endpoint
  // property, so this list is a measurement, not something derivable from
  // the model names.
  it("reports each shipped model's own vision support", () => {
    for (const option of getModelOptions()) {
      expect(modelSupportsVision(option.value)).toBe(option.supportsVision);
      expect(canSendImages(option.value)).toBe(option.supportsVision);
    }
    expect(
      getModelOptions().filter((option) => !option.supportsVision).map((o) => o.value),
    ).toEqual([
      "tencent/hy4-preview",
      "z-ai/glm-5.3",
      "z-ai/glm-5.2",
      "opencode-go/glm-5.3",
      "opencode-go/glm-5.2",
      "opencode/deepseek-v4-flash",
      "opencode/minimax-m3",
    ]);
  });

  // A stale saved selection, or a model the backend added after this bundle
  // was built: assumed vision-capable, matching the backend's own convention
  // for an id with no metadata.
  it("assumes an unknown model reads images", () => {
    expect(modelSupportsVision("who/knows")).toBe(true);
  });
});

describe("chatModels canUseModel", () => {
  it("is false for a totally unknown id", () => {
    expect(canUseModel("nonexistent/model")).toBe(false);
  });

  it("is true for an OpenRouter entry regardless of any stored key", () => {
    expect(canUseModel("deepseek/deepseek-v4.1-flash")).toBe(true);
  });

  it("is false for an OpenCode BYOK entry with no key stored", () => {
    clearOpenCodeKey();
    expect(canUseModel("opencode-go/glm-5.3-flash")).toBe(false);
  });

  it("is true for an OpenCode BYOK entry once a key is stored", () => {
    setOpenCodeKey("sk-test");
    expect(canUseModel("opencode-go/glm-5.3-flash")).toBe(true);
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
    expect(fresh.getModelOptions()).toHaveLength(21);
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

describe("getModelContextWindow", () => {
  it("returns the fallback window for a known model", () => {
    expect(getModelContextWindow("deepseek/deepseek-v4.1-flash")).toBe(1048576);
    expect(getModelContextWindow("opencode/kimi-k2.7-code")).toBe(262144);
  });

  it("returns undefined for an unknown model id", () => {
    expect(getModelContextWindow("nobody/knows-this-model")).toBeUndefined();
  });

  it("returns undefined once the backend reports a model with no contextWindow", async () => {
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

    expect(fresh.getModelContextWindow("m")).toBeUndefined();
  });

  it("picks up a contextWindow the backend reports", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          models: [
            { id: "m", label: "M", supportsVision: true, contextWindow: 777_000 },
          ],
          default: "m",
          visionFallback: false,
        }),
      })),
    );

    const fresh = await import("@/lib/chatModels");
    await fresh.loadModels();

    expect(fresh.getModelContextWindow("m")).toBe(777_000);
  });
});
