import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { WEBMCP_ALLOWED_NAMES, WEBMCP_TOOL_SPECS } from "@/lib/webmcp/schemas";
import { toolHandlers } from "@/lib/toolRegistry";

/**
 * Keeps src/lib/webmcp/schemas.ts honest against the contracts it copies.
 *
 * The schemas have to live in this bundle (the frontend ships without the
 * backend, and the editor works offline), so they are a second copy of a
 * contract owned by pen-editor-backend/src/ai/tools.ts. This is the same
 * problem the tool-*name* lists already have, and it is solved the same way:
 * import the sibling checkout at test time and assert the copy still holds.
 *
 * The asserted direction is one-way on purpose. The WebMCP surface may be
 * *tighter* than the backend's schema — it publishes fewer properties, and
 * may require one the backend leaves optional — but it must never accept
 * something the backend's contract does not describe, because the frontend
 * handler behind it was written against that contract.
 */

describe("WebMCP tool specs", () => {
  it("only publishes tools from the curated agent-facing set", () => {
    for (const spec of WEBMCP_TOOL_SPECS) {
      expect(WEBMCP_ALLOWED_NAMES, spec.name).toContain(spec.name);
    }
  });

  it("has a real handler behind every published tool", () => {
    for (const spec of WEBMCP_TOOL_SPECS) {
      expect(Object.prototype.hasOwnProperty.call(toolHandlers, spec.name), spec.name).toBe(true);
    }
  });

  it("publishes no tool twice", () => {
    const names = WEBMCP_TOOL_SPECS.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("closes every object schema and describes every tool", () => {
    for (const spec of WEBMCP_TOOL_SPECS) {
      expect(spec.inputSchema.type, spec.name).toBe("object");
      expect(spec.inputSchema.additionalProperties, spec.name).toBe(false);
      expect(spec.description.trim().length, spec.name).toBeGreaterThan(20);
    }
  });

  // The annotation is what an agent reads to decide whether a call is safe.
  // A mutating tool advertising readOnly would be a lie with consequences.
  it("derives annotations from the mutating flag, never by hand", () => {
    for (const spec of WEBMCP_TOOL_SPECS) {
      expect(spec.annotations.readOnlyHint, spec.name).toBe(!spec.mutating);
    }
  });

  it("marks exactly the scene-writing tools as mutating", () => {
    const mutating = WEBMCP_TOOL_SPECS.filter((spec) => spec.mutating).map((spec) => spec.name);
    expect(mutating.sort()).toEqual(["batch_design", "set_variables"]);
  });

  // publish_to_showcase publishes a design to a public gallery: irreversible
  // from the agent's side and consequential by any reading. It is not in the
  // MCP subset and must not drift into this one.
  it("publishes nothing consequential", () => {
    const names = WEBMCP_TOOL_SPECS.map((spec) => spec.name);
    for (const forbidden of ["publish_to_showcase", "create_plugin", "ask_user"]) {
      expect(names).not.toContain(forbidden);
    }
  });
});

const backendToolsPath = resolve(process.cwd(), "../pen-editor-backend/src/ai/tools.ts");
const backendExists = existsSync(backendToolsPath);

if (process.env.CONTRACT_REQUIRE_BACKEND && !backendExists) {
  throw new Error(`CONTRACT_REQUIRE_BACKEND is set but ${backendToolsPath} does not exist`);
}

interface ZodLike {
  isOptional?: () => boolean;
}

describe.runIf(backendExists)("WebMCP schemas against the backend zod shapes", () => {
  async function loadShapes(): Promise<Record<string, Record<string, ZodLike>>> {
    const mod = (await import(/* @vite-ignore */ backendToolsPath)) as Record<string, unknown>;
    return {
      get_editor_state: mod.getEditorStateInputShape as Record<string, ZodLike>,
      batch_get: mod.batchGetInputShape as Record<string, ZodLike>,
      snapshot_layout: mod.snapshotLayoutInputShape as Record<string, ZodLike>,
      get_variables: mod.getVariablesInputShape as Record<string, ZodLike>,
      set_variables: mod.setVariablesInputShape as Record<string, ZodLike>,
      batch_design: mod.batchDesignInputShape as Record<string, ZodLike>,
    };
  }

  it("declares no property the backend shape does not have", async () => {
    const shapes = await loadShapes();

    for (const [toolName, shape] of Object.entries(shapes)) {
      const spec = WEBMCP_TOOL_SPECS.find((s) => s.name === toolName);
      const published = Object.keys(spec?.inputSchema.properties ?? {});
      const unknown = published.filter(
        (key) => !Object.prototype.hasOwnProperty.call(shape, key)
      );
      expect(unknown, `${toolName} publishes properties the backend does not declare`).toEqual([]);
    }
  });

  it("requires nothing the backend shape does not accept", async () => {
    const shapes = await loadShapes();

    for (const [toolName, shape] of Object.entries(shapes)) {
      const spec = WEBMCP_TOOL_SPECS.find((s) => s.name === toolName);
      for (const key of spec?.inputSchema.required ?? []) {
        expect(Object.prototype.hasOwnProperty.call(shape, key), `${toolName}.${key}`).toBe(true);
      }
    }
  });

  // batch_design is the one deliberate tightening: the backend shape carries
  // `operations` plus three alias keys for models that emit the wrong name,
  // and normalizes them before bridging. A WebMCP caller writes to a
  // published schema, so this surface offers the canonical field alone — and
  // requires it, because the frontend handler reads nothing else.
  it("publishes batch_design as operations-only and required", async () => {
    const shapes = await loadShapes();
    const spec = WEBMCP_TOOL_SPECS.find((s) => s.name === "batch_design");

    expect(Object.keys(spec!.inputSchema.properties ?? {})).toEqual(["operations"]);
    expect(spec!.inputSchema.required).toEqual(["operations"]);
    for (const alias of ["design", "script", "batch"]) {
      expect(Object.keys(shapes.batch_design)).toContain(alias);
    }
  });

  it("keeps get_editor_state's required field required, as the backend has it", async () => {
    const shapes = await loadShapes();

    expect(shapes.get_editor_state.include_schema.isOptional?.()).toBe(false);
    expect(
      WEBMCP_TOOL_SPECS.find((s) => s.name === "get_editor_state")!.inputSchema.required
    ).toEqual(["include_schema"]);
  });
});

describe.runIf(!backendExists)("WebMCP schema sync (skipped)", () => {
  it.skip("pen-editor-backend not found next to pen-editor", () => {});
});
