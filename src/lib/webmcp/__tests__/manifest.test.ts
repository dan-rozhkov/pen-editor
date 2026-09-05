import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildWebMcpManifest } from "../manifest";
import { WEBMCP_TOOL_NAMES, WEBMCP_TOOL_SPECS } from "../schemas";

/**
 * `vite.config.ts` imports this module chain through `vite/webmcpManifest.ts`,
 * and esbuild loads that config with neither the project's `@/` alias nor any
 * DOM globals. Either mistake breaks `vite dev` and `vite build` outright — so
 * the guard has to be on the *source*, not on a call: running the builder
 * under happy-dom proves nothing, because happy-dom is precisely what supplies
 * the globals a Node config load would not have.
 */
const MODULE_CHAIN = ["../manifest.ts", "../schemas.ts", "../types.ts", "../../mcpToolNames.ts"];

function sourceOf(relative: string): string {
  return readFileSync(path.resolve(__dirname, relative), "utf8");
}

/** Strips comments and string/template literals so prose can't false-positive. */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

describe("buildWebMcpManifest", () => {
  it("builds without touching the DOM", () => {
    expect(() => buildWebMcpManifest()).not.toThrow();
  });

  it.each(MODULE_CHAIN)("%s uses no @/ alias, so vite.config.ts can import it", (relative) => {
    expect(sourceOf(relative)).not.toMatch(/from\s+["']@\//);
  });

  it.each(MODULE_CHAIN)("%s references no browser global", (relative) => {
    const code = stripCommentsAndStrings(sourceOf(relative));
    expect(code).not.toMatch(/\b(document|window|navigator|localStorage|location)\s*\./);
  });

  it("writes its routes under the configured base", () => {
    const manifest = buildWebMcpManifest("/pen-editor/");
    expect(manifest.routes.editor).toEqual([
      "/pen-editor/app",
      "/pen-editor/app/*",
      "/pen-editor/c/:shareId",
    ]);
    expect(manifest.routes.showcase).toBe("/pen-editor/");
    expect(manifest.readOnly.routes).toEqual(["/pen-editor/c/:shareId"]);
  });

  it("lists exactly the same tool names as WEBMCP_TOOL_NAMES, in order", () => {
    const manifest = buildWebMcpManifest();
    expect(manifest.tools.map((tool) => tool.name)).toEqual(WEBMCP_TOOL_NAMES);
  });

  it("every tool has a non-empty description and inputSchema matching its spec", () => {
    const manifest = buildWebMcpManifest();
    const specsByName = new Map(WEBMCP_TOOL_SPECS.map((spec) => [spec.name, spec]));

    for (const tool of manifest.tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeTruthy();

      const spec = specsByName.get(tool.name);
      expect(spec).toBeDefined();
      expect(tool.inputSchema).toEqual(spec!.inputSchema);
      expect(tool.description).toEqual(spec!.description);
      expect(tool.annotations).toEqual(spec!.annotations);
    }
  });

  it("survives a JSON round-trip unchanged", () => {
    const manifest = buildWebMcpManifest();
    const roundTripped = JSON.parse(JSON.stringify(manifest));
    expect(roundTripped).toEqual(manifest);
  });

  it("names the call method and API from the actual polyfill contract, not a duplicated string", () => {
    const manifest = buildWebMcpManifest();
    // getModelContext() reads navigator.modelContext (with a document
    // fallback) and ModelContextLike declares executeTool(tool, args) with
    // args as a JSON string — see types.ts/polyfill.ts. This test only pins
    // that the manifest's prose actually names those, not a copy that could
    // drift from a future rename.
    expect(manifest.surface.api).toBe("navigator.modelContext");
    expect(manifest.surface.callMethod).toContain("executeTool");
    expect(manifest.surface.argsEncoding.toLowerCase()).toContain("json");
  });

  it("declares routes matching earlyInstall's isEditorRoute rule and calls out the showcase as tool-less", () => {
    const manifest = buildWebMcpManifest();
    expect(manifest.routes.editor).toEqual(["/app", "/app/*", "/c/:shareId"]);
    expect(manifest.routes.showcase).toBe("/");
  });

  it("documents that mutating tools are withheld on shared/read-only canvases", () => {
    const manifest = buildWebMcpManifest();
    expect(manifest.readOnly.routes).toContain("/c/:shareId");
    expect(manifest.readOnly.note).toMatch(/batch_design/);
    expect(manifest.readOnly.note).toMatch(/set_variables/);
  });

  it("warns that an empty getTools() means 'not yet', not 'unsupported'", () => {
    const manifest = buildWebMcpManifest();
    expect(manifest.readiness.note.toLowerCase()).toContain("gettools");
  });
});
