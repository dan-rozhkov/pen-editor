import { describe, it, expect } from "vitest";
import {
  AUTO_MODEL_VALUE,
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
    ]);
  });

  it("resolves Auto to the backend default (Gemini 2.5 Flash by default)", () => {
    expect(resolveModel(AUTO_MODEL_VALUE)).toBe("google/gemini-2.5-flash");
  });

  it("passes concrete model ids through unchanged", () => {
    expect(resolveModel("moonshotai/kimi-k2.5")).toBe("moonshotai/kimi-k2.5");
  });

  it("treats Auto as vision-capable via its resolved model", () => {
    expect(modelSupportsVision(AUTO_MODEL_VALUE)).toBe(true);
  });
});
