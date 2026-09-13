import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { getChatModel } from "@/lib/chatModels";

// The hardcoded fallback in src/lib/chatModels.ts is only a
// first-paint/offline safety net — no request carries a model id any more, so
// a drifting id can no longer 400 a turn. It is still what the composer shows
// and what decides whether the attach button is live before GET /api/models
// answers, so it must keep naming the model the backend actually runs.
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
  async function loadBackendModels(): Promise<
    { id: string; label: string; supportsVision: boolean }[]
  > {
    const mod = (await import(/* @vite-ignore */ backendConfigPath)) as {
      DEFAULT_MODELS: { id: string; label: string; supportsVision: boolean }[];
    };
    return mod.DEFAULT_MODELS;
  }

  it("the fallback model is the backend's single shipped model", async () => {
    const backendModels = await loadBackendModels();
    expect(backendModels).toHaveLength(1);
    expect(getChatModel()).toEqual(backendModels[0]);
  });
});
