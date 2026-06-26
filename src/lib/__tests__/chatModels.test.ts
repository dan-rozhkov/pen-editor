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

  it("resolves Auto to the backend default (Gemini 2.5 Flash by default)", () => {
    expect(resolveModel(AUTO_MODEL_VALUE)).toBe("google/gemini-2.5-flash");
  });

  it("passes concrete model ids through unchanged", () => {
    expect(resolveModel("moonshotai/kimi-k2.6")).toBe("moonshotai/kimi-k2.6");
  });

  it("treats Auto as vision-capable via its resolved model", () => {
    expect(modelSupportsVision(AUTO_MODEL_VALUE)).toBe(true);
  });
});
