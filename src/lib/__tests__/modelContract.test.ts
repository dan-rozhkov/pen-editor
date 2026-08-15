import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { AUTO_MODEL_VALUE, getModelOptions, resolveModel } from "@/lib/chatModels";

// The hardcoded fallback list in src/lib/chatModels.ts is only a
// first-paint/offline safety net — but it is not inert. Anything the editor
// sends before GET /api/models resolves (the showcase "ask the agent" handoff
// auto-sends on mount) travels with a model id taken from that list, and the
// backend rejects an id outside its allow-list with a 400. A fallback entry
// that drifts from the backend's DEFAULT_MODELS is therefore a live bug, not
// stale documentation — this is exactly how "deepseek/deepseek-v4-flash-0731"
// (an id that never existed on the backend) broke the showcase handoff.
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

  it("every fallback model exists in the backend's DEFAULT_MODELS", async () => {
    const backendIds = new Set((await loadBackendModels()).map((m) => m.id));
    const fallbackIds = getModelOptions()
      .map((option) => option.value)
      .filter((value) => value !== AUTO_MODEL_VALUE);

    expect(fallbackIds.length).toBeGreaterThan(0);
    for (const id of fallbackIds) {
      expect(backendIds, id).toContain(id);
    }
  });

  it("the model Auto falls back to is one the backend allows", async () => {
    const backendIds = new Set((await loadBackendModels()).map((m) => m.id));
    expect(backendIds).toContain(resolveModel(AUTO_MODEL_VALUE));
  });

  it("fallback labels and vision flags match the backend's", async () => {
    const backendById = new Map(
      (await loadBackendModels()).map((m) => [m.id, m])
    );
    for (const option of getModelOptions()) {
      if (option.value === AUTO_MODEL_VALUE) continue;
      const backend = backendById.get(option.value);
      if (!backend) continue; // covered by the id test above
      expect({ label: option.label, supportsVision: option.supportsVision }).toEqual({
        label: backend.label,
        supportsVision: backend.supportsVision,
      });
    }
  });
});
