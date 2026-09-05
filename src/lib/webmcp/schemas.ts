import { BRIDGED_MCP_TOOL_NAMES, STATIC_MCP_TOOL_NAMES } from "../mcpToolNames";
import type { JsonSchema, ToolAnnotationHints } from "./types";

/**
 * The WebMCP contract for the tools pen-editor publishes to in-page agents.
 *
 * Source of truth and drift control
 * ---------------------------------
 * The authoritative schemas are the zod shapes in
 * pen-editor-backend/src/ai/tools.ts, surfaced to MCP clients by
 * pen-editor-backend/src/mcp/server.ts. Those cannot be imported here: the
 * frontend builds and ships without the backend checked out, and the editor
 * must keep working offline, so the schemas have to be in this bundle.
 *
 * This is therefore a second copy of a contract, which is exactly the thing
 * that rots silently. It is held in place the same way this repository
 * already holds the tool-*name* lists in place: by a contract test that
 * imports the sibling backend checkout at test time
 * (src/lib/webmcp/__tests__/webmcpContract.test.ts, alongside
 * src/lib/__tests__/toolContract.test.ts). The test asserts the direction
 * that matters — this surface may be *tighter* than the backend's, never
 * looser:
 *
 *   - every property declared here exists in the backend shape;
 *   - every property this file marks required is one the backend also
 *     accepts;
 *   - no tool appears here that is not in DESKTOP_MCP_TOOL_NAMES.
 *
 * Being deliberately tighter in one place: batch_design's backend shape
 * declares `operations` plus three optional aliases (`design`, `script`,
 * `batch`) that exist to absorb key-name mistakes from LLMs emitting tool
 * calls. The MCP server normalizes them before bridging, and the frontend
 * handler only ever reads `operations`. A WebMCP caller is writing to a
 * published schema rather than guessing at one, so this surface publishes
 * the canonical field alone and requires it.
 */

export interface WebMcpToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotationHints;
  /**
   * True when the tool writes to the scene. Drives both the read-only gate
   * (registerTools.ts) and the `readOnlyHint` annotation, so the two can
   * never disagree.
   */
  mutating: boolean;
}

/** Node types accepted by batch_get's `patterns[].type`. */
const NODE_TYPES = [
  "frame",
  "group",
  "rectangle",
  "ellipse",
  "line",
  "polygon",
  "path",
  "text",
  "embed",
  "ref",
  "connector",
] as const;

const readOnly: ToolAnnotationHints = {
  readOnlyHint: true,
  // Everything these tools return is authored inside the user's document —
  // layer names, text content, variable names, style-guide prose. An agent
  // must treat it as data to report on, never as instructions to follow.
  untrustedContentHint: true,
};

const mutating: ToolAnnotationHints = {
  readOnlyHint: false,
  untrustedContentHint: true,
};

export const WEBMCP_TOOL_SPECS: readonly WebMcpToolSpec[] = [
  {
    name: "get_editor_state",
    description:
      "Get the current editor state: active .pen file, user selection, top-level nodes, and available components. Call this first — Figma's metadata-first pattern.",
    inputSchema: {
      type: "object",
      properties: {
        include_schema: {
          type: "boolean",
          description:
            "Whether to include the .pen file schema in the response. Set true if you need to understand the node format.",
        },
      },
      required: ["include_schema"],
      additionalProperties: false,
    },
    annotations: readOnly,
    mutating: false,
  },
  {
    name: "batch_get",
    description:
      "Retrieve nodes by id or search pattern, with depth control. Use to inspect structure before modifying.",
    inputSchema: {
      type: "object",
      properties: {
        patterns: {
          type: "array",
          description: "Search patterns to match nodes",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: NODE_TYPES,
                description: "Only return nodes with this type",
              },
              name: {
                type: "string",
                maxLength: 200,
                description: "Only return nodes whose name matches this regex pattern",
              },
            },
            additionalProperties: false,
          },
        },
        nodeIds: {
          type: "array",
          maxItems: 500,
          description: "Specific node IDs to read",
          items: { type: "string" },
        },
        parentId: { type: "string", description: "Parent node ID to limit search scope" },
        readDepth: {
          type: "integer",
          minimum: 0,
          maximum: 50,
          description:
            "How deep to read children (default 1). Nodes beyond this depth show as '...'.",
        },
        searchDepth: {
          type: "integer",
          minimum: 0,
          maximum: 50,
          description: "How deep to search in the node tree. Unlimited if omitted.",
        },
        resolveVariables: {
          type: "boolean",
          description: "If true, variable references are resolved to their current values.",
        },
        includePathGeometry: {
          type: "boolean",
          description: "If true, include full SVG path geometry data.",
        },
      },
      additionalProperties: false,
    },
    annotations: readOnly,
    mutating: false,
  },
  {
    name: "snapshot_layout",
    description:
      "Get computed layout rectangles (positions/sizes after the layout engine runs). Key for design-to-code fidelity — use to check placement, overlap, and clipping.",
    inputSchema: {
      type: "object",
      properties: {
        parentId: {
          type: "string",
          description: "Subtree root to inspect. Omit for the whole document.",
        },
        maxDepth: {
          type: "integer",
          minimum: 0,
          maximum: 50,
          description:
            "Depth limit for traversal. Default is direct children only. Be careful with large values.",
        },
        problemsOnly: {
          type: "boolean",
          description: "If true, only return nodes with layout problems (clipping, overflow).",
        },
      },
      additionalProperties: false,
    },
    annotations: readOnly,
    mutating: false,
  },
  {
    name: "get_variables",
    description: "Read all design variables (tokens) and themes defined in the .pen file.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnly,
    mutating: false,
  },
  {
    name: "get_screenshot",
    description:
      "Take a screenshot of a node for visual verification. Omit nodeId to screenshot the current selection (errors if none or more than one node is selected). Returns a PNG data URL.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: {
          type: "string",
          description: "Node to screenshot. Omit to use the current selection.",
        },
      },
      additionalProperties: false,
    },
    annotations: readOnly,
    mutating: false,
  },
  {
    name: "batch_design",
    description:
      "Create, update, and delete nodes on the canvas by running a batch operations script. Call get_guidelines(topic: \"design-system\") first for auto-layout and component-usage rules. Changes are applied to the open document and can be undone by the user.",
    inputSchema: {
      type: "object",
      properties: {
        operations: {
          type: "string",
          minLength: 1,
          description:
            "The operations script: I(parent, {...}) to insert, U(id, {...}) to update, D(id) to delete, one operation per line.",
        },
      },
      required: ["operations"],
      additionalProperties: false,
    },
    annotations: mutating,
    mutating: true,
  },
  {
    name: "set_variables",
    description:
      "Add or update design variables and themes in the open document. Merges by default; replace=true overwrites all.",
    inputSchema: {
      type: "object",
      properties: {
        variables: {
          type: "object",
          description:
            'Variable definitions, as an object keyed by variable name. Simplest form — a plain hex string per name: {"--brand-primary": "#3b82f6"}. Full form — an object per name with `type` ("color" | "number" | "string", default "color") and `value`. Per-theme values use `themeValues`. Names may be given with or without a leading `--`/`$`.',
        },
        replace: {
          type: "boolean",
          description: "If true, replaces all existing variables. Default is merge.",
        },
      },
      required: ["variables"],
      additionalProperties: false,
    },
    annotations: mutating,
    mutating: true,
  },
  {
    name: "attach_local_repo",
    description:
      "Push a local repository (or a chunk of one) into this editor session so read_design_repo/read_repo_files serve from it instead of GitHub. Send name + tree + files to attach or replace; mode:\"append\" adds more files/tree paths to an existing attachment (how a large repo is chunked); detach:true clears the current attachment. Caps apply per call and per attachment — a rejected call reports the reason so you know whether to retry smaller or stop.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            'Name of the repo being attached (e.g. a folder or project name). Required unless detach is true or mode is "append" onto an existing attachment.',
        },
        tree: {
          type: "array",
          description: "Repo-relative file paths, for structure/listing purposes.",
          items: { type: "string" },
        },
        files: {
          type: "array",
          description: "File contents to attach, as {path, content} objects.",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
        mode: {
          type: "string",
          enum: ["replace", "append"],
          description:
            'Default "replace" clears any current attachment first; "append" adds to the current attachment (requires one already attached).',
        },
        detach: {
          type: "boolean",
          description: "If true, clears the current attachment and ignores every other field.",
        },
      },
      additionalProperties: false,
    },
    // Treated as mutating for the read-only gate even though it never
    // touches the scene graph: it writes session state (repoContextStore)
    // that the design agent's own tools then read from, so on a shared
    // `/c/:id` canvas a stranger's agent must not be able to push a
    // repository into someone else's session any more than it could call
    // batch_design or set_variables there.
    annotations: mutating,
    mutating: true,
  },
  {
    name: "get_guidelines",
    description:
      "Get design guidelines and rules for a topic (design-system, code, table, tailwind, landing-page).",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: ["code", "table", "tailwind", "landing-page", "design-system"],
        },
      },
      required: ["topic"],
      additionalProperties: false,
    },
    annotations: readOnly,
    mutating: false,
  },
  {
    name: "get_style_guide_tags",
    description:
      "Get all available style guide tags. Call before get_style_guide to know which tags to use.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnly,
    mutating: false,
  },
  {
    name: "get_style_guide",
    description: "Get a style guide for design inspiration, by tags or by name.",
    inputSchema: {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" } },
        name: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: readOnly,
    mutating: false,
  },
];

/**
 * The names this module publishes, in the order they are registered. Pinned
 * against the repository's existing agent-facing name lists so a tool cannot
 * be added here without also being an acknowledged MCP tool.
 */
export const WEBMCP_TOOL_NAMES = WEBMCP_TOOL_SPECS.map((spec) => spec.name);

/**
 * The curated agent-facing set this surface is a subset of.
 *
 * `attach_local_repo` is listed here directly rather than folded into
 * `BRIDGED_MCP_TOOL_NAMES`/`mcpToolNames.ts`: it is a WebMCP-only tool, not
 * part of the desktop shell's MCP bridge (`DESKTOP_MCP_TOOL_NAMES`) or the
 * backend's `BRIDGED_TOOL_NAMES` — the only way to reach it is an agent
 * driving this tab directly, which is the whole point (see the tool's own
 * comment). Adding it to `mcpToolNames.ts` would incorrectly advertise it
 * over the desktop bridge too.
 */
export const WEBMCP_ALLOWED_NAMES: readonly string[] = [
  ...BRIDGED_MCP_TOOL_NAMES,
  ...STATIC_MCP_TOOL_NAMES,
  "attach_local_repo",
];
