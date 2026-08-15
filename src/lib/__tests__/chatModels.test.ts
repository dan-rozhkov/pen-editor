import { describe, it, expect, afterEach, vi } from "vitest";
import {
  AUTO_MODEL_VALUE,
  canSendImages,
  getDefaultModel,
  getModelOptions,
  modelSupportsVision,
  resolveModel,
} from "@/lib/chatModels";

describe("chatModels Auto option", () => {
  it("defaults the selection to Auto", () => {
    expect(getDefaultModel()).toBe(AUTO_MODEL_VALUE);
  });

  it("lists Auto first in the options", () => {
    const options = getModelOptions();
    expect(options[0]).toMatchObject({ value: AUTO_MODEL_VALUE, label: "Auto" });
  });

  it("uses the curated model list as its offline fallback", () => {
    expect(getModelOptions().map((model) => model.value)).toEqual([
      AUTO_MODEL_VALUE,
      "google/gemini-2.5-flash",
      "z-ai/glm-5.2",
      "moonshotai/kimi-k2.5",
      "minimax/minimax-m3",
      "xiaomi/mimo-v2.5-pro",
      "xiaomi/mimo-v2.5",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
      "tencent/hy3",
      "nvidia/nemotron-3-ultra-550b-a55b",
      "stepfun/step-3.7-flash",
      "x-ai/grok-build-0.1",
      "thinkingmachines/inkling",
      "kwaipilot/kat-coder-pro-v2.5",
      "x-ai/grok-4.20",
      "google/gemini-3.5-flash-lite",
      "google/gemini-3.7-flash",
    ]);
  });

  it("resolves Auto to the backend default (DeepSeek V4 Pro by default)", () => {
    expect(resolveModel(AUTO_MODEL_VALUE)).toBe("deepseek/deepseek-v4-pro");
  });

  it("passes concrete model ids through unchanged", () => {
    expect(resolveModel("moonshotai/kimi-k2.5")).toBe("moonshotai/kimi-k2.5");
  });

  it("uses the resolved model capabilities for Auto", () => {
    expect(modelSupportsVision(AUTO_MODEL_VALUE)).toBe(false);
  });

  it("canSendImages matches modelSupportsVision when no backend vision fallback has loaded", () => {
    // Auto resolves to deepseek/deepseek-v4-pro, which has no native
    // vision in the fallback list; without a successful /api/models fetch,
    // visionFallback stays at its conservative default (false).
    expect(canSendImages(AUTO_MODEL_VALUE)).toBe(false);
    expect(canSendImages("google/gemini-2.5-flash")).toBe(true);
  });
});

describe("chatModels visionFallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("lets a non-vision model send images once the backend reports visionFallback: true", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          models: [
            { id: "text-only/model", label: "Text Only", supportsVision: false },
          ],
          default: "text-only/model",
          visionFallback: true,
        }),
      })),
    );

    const fresh = await import("@/lib/chatModels");
    await fresh.loadModels();

    expect(fresh.modelSupportsVision("text-only/model")).toBe(false);
    expect(fresh.canSendImages("text-only/model")).toBe(true);
  });

  it("keeps visionFallback false (and canSendImages gated on native vision) when the fetch fails", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );

    const fresh = await import("@/lib/chatModels");
    await fresh.loadModels();

    expect(fresh.canSendImages("deepseek/deepseek-v4-flash")).toBe(false);
  });
});
