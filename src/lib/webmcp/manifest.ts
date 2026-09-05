import { WEBMCP_TOOL_SPECS } from "./schemas";
import type { JsonSchema, ToolAnnotationHints } from "./types";

/**
 * A static, agent-readable description of the WebMCP surface, served as
 * `/webmcp.json` (see `vite/webmcpManifest.ts`) and pointed to from
 * `index.html`.
 *
 * Why this exists: `src/lib/webmcp/` publishes real tools on
 * `navigator.modelContext`, but only to an agent that already executed the
 * page's JavaScript and thought to look there. An agent that only fetched the
 * URL — curl, WebFetch, a crawler — sees an empty SPA shell and has no way to
 * discover the surface at all. This module has no such reader in mind: it is
 * pure data, built from the same `WEBMCP_TOOL_SPECS` the in-page registration
 * uses, so the two can never describe two different tool sets.
 *
 * Deliberately DOM-free: this file (and everything it imports — `schemas.ts`,
 * `mcpToolNames.ts`, `types.ts`) must stay free of the `@/` alias so
 * `vite.config.ts` — loaded by esbuild without the project's path aliases —
 * can import `buildWebMcpManifest` directly to serve/emit the manifest.
 */

/** One tool entry in the manifest — the caller-facing subset of a spec. */
export interface WebMcpManifestTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotationHints;
}

export interface WebMcpManifest {
  name: string;
  description: string;
  surface: {
    kind: "in-page";
    description: string;
    api: string;
    /** The same object's second address; see the value for why both exist. */
    alsoAt: string;
    callMethod: string;
    argsEncoding: string;
    example: string;
  };
  routes: {
    editor: readonly string[];
    showcase: string;
    note: string;
  };
  readOnly: {
    routes: readonly string[];
    note: string;
  };
  readiness: {
    note: string;
  };
  tools: readonly WebMcpManifestTool[];
}

/**
 * `base` is Vite's configured base path ("/" locally and on render.com,
 * "/pen-editor/" for the GitHub Pages build). Every route in the manifest is
 * written under it: an agent that reads this file has no other way to learn
 * the app is not at the origin root, and a bare "/app" would send it to a 404
 * on the Pages deploy. The default keeps the common case honest for callers
 * (tests, the plugin before `configResolved`) that have no base to pass.
 */
export function buildWebMcpManifest(base = "/"): WebMcpManifest {
  const at = (path: string) => `${base}${path}`;

  return {
    name: "Pen Editor",
    description:
      "AI-first canvas design editor. On its editor routes it publishes an agent-facing toolset for reading and mutating the open design document.",
    surface: {
      kind: "in-page",
      description:
        "These tools are not an HTTP API — there is no endpoint to POST to. They exist only inside the loaded page, registered on navigator.modelContext (the WebMCP proposal; polyfilled here since no stable browser ships it yet — see src/lib/webmcp/polyfill.ts). An agent must run JavaScript in the tab (a browser extension, Playwright, CDP, or the desktop shell) to discover or call them.",
      api: "navigator.modelContext",
      // The same object under a second name. Not decoration: the shipped
      // Chrome builds that expose this API at all put it on `document`,
      // while the proposal says `navigator`, so an agent checks whichever
      // one its own reference named and concludes "unsupported" if it looks
      // at the other. Naming both here is cheaper than being right about
      // which one wins.
      alsoAt: "document.modelContext",
      callMethod: "navigator.modelContext.executeTool(tool, args)",
      argsEncoding:
        "`args` is a JSON *string*, not a plain object — passing an object fails with \"Failed to parse input arguments\". Encode the tool's inputSchema fields, then JSON.stringify them.",
      example:
        'await navigator.modelContext.executeTool("get_editor_state", JSON.stringify({ include_schema: false }));',
    },
    routes: {
      editor: [at("app"), at("app/*"), at("c/:shareId")],
      showcase: base,
      note: `The tools exist only on the editor routes above. The showcase gallery at "${base}" never registers a model context — there is no document open there to act on.`,
    },
    readOnly: {
      routes: [at("c/:shareId")],
      note: "On a shared, view-only canvas the mutating tools (batch_design, set_variables) are not published at all, and the read tools' output is narrowed to what the viewer can actually see (hidden nodes are reduced to id/type/name; embed and component source HTML is stripped).",
    },
    readiness: {
      note: 'getTools() can legitimately return an empty array right after the page loads — the editor that registers tools is a lazily loaded chunk that has not run its first effect yet. An empty list means "not yet, ask again shortly", not "this page has no tools." There is no readiness event; poll getTools() for a second or two rather than sampling once.',
    },
    tools: WEBMCP_TOOL_SPECS.map((spec) => ({
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema,
      annotations: spec.annotations,
    })),
  };
}
