import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { getDefaultModel, getModelOptions } from "@/lib/chatModels";

// The hardcoded fallback list in src/lib/chatModels.ts is only a
// first-paint/offline safety net — a drifting id cannot break a turn, since
// the backend IGNORES a model id outside its own list and runs its default
// instead. It IS the menu the user picks from before GET /api/models answers,
// and what decides whether the attach button is live, so it must keep naming
// the models the backend actually offers.
//
// Vitest runs with cwd = pen-editor/, the sibling backend repo lives next to it.
const backendConfigPath = resolve(
  process.cwd(),
  "../pen-editor-backend/src/config.ts"
);
const backendExists = existsSync(backendConfigPath);

if (process.env.CONTRACT_REQUIRE_BACKEND && !backendExists) {
  throw new Error(
    `CONTRACT_REQUIRE_BACKEND is set but ${backendConfigPath} does not exist`
  );
}

describe.runIf(backendExists)("chat model fallback contract", () => {
  async function loadBackend(): Promise<{
    DEFAULT_MODELS: { id: string; label: string; supportsVision: boolean }[];
    envSchema: { shape: { CHAT_MODEL: { parse: (v: undefined) => string } } };
  }> {
    return (await import(/* @vite-ignore */ backendConfigPath)) as never;
  }

  it("the fallback list is the backend's selectable model list", async () => {
    const { DEFAULT_MODELS } = await loadBackend();
    expect(getModelOptions()).toEqual(
      DEFAULT_MODELS.map((model) => ({
        value: model.id,
        label: model.label,
        supportsVision: model.supportsVision,
      }))
    );
  });

  it("the fallback default is the backend's CHAT_MODEL default", async () => {
    const { envSchema } = await loadBackend();
    expect(getDefaultModel()).toBe(envSchema.shape.CHAT_MODEL.parse(undefined));
  });
});
