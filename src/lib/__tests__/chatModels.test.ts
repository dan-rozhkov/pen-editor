import { describe, it, expect, afterEach, vi } from "vitest";
import { canSendImages, getChatModel, modelSupportsVision } from "@/lib/chatModels";

describe("chatModels fallback", () => {
  it("reports the single shipped model before any /api/models response", () => {
    expect(getChatModel()).toEqual({
      id: "deepseek/deepseek-v4.1-flash",
      label: "DeepSeek V4.1 Flash",
      supportsVision: true,
    });
  });

  it("allows images on the fallback, which reads them natively", () => {
    expect(modelSupportsVision()).toBe(true);
    expect(canSendImages()).toBe(true);
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

    expect(fresh.getChatModel().id).toBe("text-only/model");
    expect(fresh.modelSupportsVision()).toBe(false);
    expect(fresh.canSendImages()).toBe(true);
  });

  it("keeps the hardcoded fallback model when the fetch fails", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );

    const fresh = await import("@/lib/chatModels");
    await fresh.loadModels();

    expect(fresh.getChatModel().id).toBe("deepseek/deepseek-v4.1-flash");
    expect(fresh.canSendImages()).toBe(true);
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
