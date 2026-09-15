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
   * True when the tool writes to the scene (or to session state another tool
   * then reads, like `attach_local_repo`). Drives both the read-only gate
   * (registerTools.ts) and the `readOnlyHint` annotation, so the two can
   * never disagree. This is about *writing*, nothing else — a tool can be
   * entirely read-only and still be unsafe to publish on someone else's
   * shared canvas, which is what `withheldOnSharedView` is for.
   */
  mutating: boolean;
  /**
   * True when the tool must not be published (or executed, if it slipped in
   * before the flag was checked) on a `/c/:shareId` shared, read-only canvas
   * — independent of `mutating`. `sharedViewRedaction.ts` narrows a read-only
   * tool's *result* to what the viewer's own screen can show, but that only
   * works when the result is shaped like node data the redactor can walk.
   * `read_embed_html` is the case that breaks it: its "full"/"grep" results
   * carry the embed's raw source under keys (`html`, `targetedSourceTemplate`)
   * that don't match `SOURCE_HTML_KEYS`, so the redaction pass never sees
   * them — the exact hiding place `sharedViewRedaction.ts`'s own doc comment
   * says must never reach a stranger's agent. Redacting `read_embed_html`'s
   * shape instead of withholding the tool was rejected: `outline` mode keeps
   * "attributes intact", which is its own leak (an attacker can hide text in
   * an attribute rather than in `htmlContent`), so there is no result shape
   * for this tool that is safe to narrow rather than simply not publish.
   * Checked in two places, same reasoning as `mutating`/`canMutateScene()`:
   * `registerWebMcpTools` (registration-time advertisement) and
   * `buildDefinition`'s `execute` (call-time — registration can't be
   * withdrawn, and `/c/:shareId` sets `isSharedView` from a parent effect
   * while the editor mounts lazily underneath, so registration-time gating
   * alone races).
   */
  withheldOnSharedView?: boolean;
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
      "Get the current editor state: active .pen file, user selection, and top-level nodes. Call this first — Figma's metadata-first pattern.",
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
      "Create, update, and delete nodes on the canvas by running a batch operations script. Call get_guidelines(topic: \"design-system\") first for auto-layout rules. Changes are applied to the open document and can be undone by the user.",
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
    name: "read_comments",
    description:
      "List canvas comment threads (or one thread, by threadId) for the agent to act on. Unresolved threads only by default. Use before reply_comment/resolve_comment to see what's outstanding.",
    inputSchema: {
      type: "object",
      properties: {
        includeResolved: {
          type: "boolean",
          description:
            "Whether to include resolved threads. Default false (only unresolved threads are returned).",
        },
        threadId: {
          type: "string",
          description: "If given, return only this thread instead of the full list.",
        },
      },
      additionalProperties: false,
    },
    annotations: readOnly,
    mutating: false,
  },
  {
    name: "reply_comment",
    description:
      "Append a reply to an existing comment thread, authored by you (the agent). Use this to report back after acting on a comment, or to ask a clarifying question on the thread.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "The id of the thread to reply to." },
        text: {
          type: "string",
          minLength: 1,
          description: "The reply message body (non-empty).",
        },
      },
      required: ["threadId", "text"],
      additionalProperties: false,
    },
    annotations: mutating,
    mutating: true,
  },
  {
    name: "resolve_comment",
    description:
      "Mark a comment thread as resolved. Use after you've addressed what the thread asked for.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "The id of the thread to resolve." },
      },
      required: ["threadId"],
      additionalProperties: false,
    },
    annotations: mutating,
    mutating: true,
  },
  {
    name: "leave_comment",
    description:
      'Drop one or more comment pins authored by you (the agent), each starting a new thread. Pass every comment you want to leave as a single batch in one call — this is the intended way to do design-review-style feedback (5-15 findings in one turn) without spending a tool call per pin. For each item: give nodeId to anchor the pin precisely to that node (the pin defaults to the node\'s center) — prefer this whenever a comment is about a specific layer. If there\'s no single node to anchor to, give x/y instead as a world-space canvas point. Every item needs nodeId OR both x and y (this cannot be expressed in the schema itself); an item with neither is rejected. Returns the created thread numbers so you can cite them precisely in your reply (e.g. "left 4 notes: #7-#10").',
    inputSchema: {
      type: "object",
      properties: {
        comments: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          description:
            "1-50 comments to leave in this batch (at least one item is required). Each item needs nodeId, or both x and y (never neither) — see the tool description.",
          items: {
            type: "object",
            properties: {
              nodeId: {
                type: "string",
                description:
                  "Id of the node to anchor this comment to (pin defaults to the node's center). Omit if using x/y instead.",
              },
              x: {
                type: "number",
                description:
                  "World-space canvas x coordinate for the pin. Required together with y when nodeId is omitted.",
              },
              y: {
                type: "number",
                description:
                  "World-space canvas y coordinate for the pin. Required together with x when nodeId is omitted.",
              },
              text: {
                type: "string",
                minLength: 1,
                description: "The comment body (non-empty). Be specific and actionable.",
              },
            },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
      required: ["comments"],
      additionalProperties: false,
    },
    annotations: mutating,
    mutating: true,
  },
  {
    name: "read_embed_html",
    description:
      "Read part of an existing embed node's HTML without pulling the whole document into context. `outline` (default) returns the tag structure with attributes intact and text/deep subtrees elided — use it to see how a screen is built. `grep` returns the lines matching a literal substring (`pattern`, required for this mode) with surrounding context — use it to get byte-exact anchors for edit_embed_html. `full` returns the entire HTML; avoid it unless you are genuinely rewriting the screen.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Id of the embed node to read." },
        mode: {
          type: "string",
          enum: ["outline", "grep", "full"],
          description:
            "outline = elided structure (default), grep = matches for `pattern`, full = entire HTML.",
        },
        pattern: {
          type: "string",
          description: "Literal substring to search for (not a regex). Required when mode is 'grep'.",
        },
        contextLines: {
          type: "integer",
          minimum: 0,
          maximum: 20,
          description: "Lines of context around each grep match. Default 2.",
        },
        maxDepth: {
          type: "integer",
          minimum: 1,
          maximum: 12,
          description: "Nesting depth kept in outline mode; deeper subtrees are summarized. Default 4.",
        },
      },
      required: ["nodeId"],
      additionalProperties: false,
    },
    annotations: readOnly,
    mutating: false,
    // Its results carry the embed's raw source under keys the redaction
    // pass in sharedViewRedaction.ts does not recognize (and, in outline
    // mode, attributes that could hide text redaction wouldn't catch
    // either) — see the field's doc comment in WebMcpToolSpec above for why
    // narrowing the result isn't a safe alternative here.
    withheldOnSharedView: true,
  },
  {
    name: "edit_embed_html",
    description:
      "Apply targeted text edits to an existing embed node's HTML instead of rewriting the whole screen. Each edit replaces an exact substring (`oldString`) with `newString`; an empty `newString` deletes the match. Read the fragment with read_embed_html first — matching is exact, falling back to a whitespace-tolerant match only when the exact one finds nothing and the tolerant one is unambiguous. Each oldString must occur exactly once unless replaceAll is true. Edits apply in order and atomically — if any edit fails to match, nothing is changed.",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "Id of the embed node to edit." },
        // `edits` is published as a plain array on purpose, even though the
        // backend's zod shape wraps it in a `z.preprocess` that also accepts
        // a JSON-encoded string (for models that emit the array as text).
        // That's not a drift to "fix" — see the file-header comment on
        // batch_design's aliases: this surface publishes the canonical wire
        // shape, not every form the backend tolerates from a guessing LLM.
        edits: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          description: "Edits applied in order, each against the result of the previous one (1-20 items).",
          items: {
            type: "object",
            properties: {
              oldString: {
                type: "string",
                minLength: 1,
                description: "Exact substring to find. Must occur exactly once unless replaceAll is true.",
              },
              newString: {
                type: "string",
                description: "Replacement text. An empty string deletes the matched fragment.",
              },
              replaceAll: {
                type: "boolean",
                description: "Replace every occurrence instead of requiring a unique match.",
              },
            },
            required: ["oldString", "newString"],
            additionalProperties: false,
          },
        },
      },
      required: ["nodeId", "edits"],
      additionalProperties: false,
    },
    annotations: mutating,
    mutating: true,
  },
  {
    name: "rename_layers",
    description:
      "Rename one or more layers (nodes) to logical, human-readable names in a single undoable step. Provide the node id and the new name for each layer. Read each layer's type, text content, and hierarchy first (via get_editor_state / batch_get) so the names reflect each layer's role. Leave already-meaningful names alone.",
    inputSchema: {
      type: "object",
      properties: {
        renames: {
          type: "array",
          minItems: 1,
          description: "One {id, name} entry per layer to rename.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "The node id to rename." },
              name: { type: "string", minLength: 1, description: "The new layer name (non-empty)." },
            },
            required: ["id", "name"],
            additionalProperties: false,
          },
        },
      },
      required: ["renames"],
      additionalProperties: false,
    },
    annotations: mutating,
    mutating: true,
  },
  {
    name: "find_empty_space_on_canvas",
    description:
      "Find an empty rectangle of the requested size near existing content, searching in one direction from a reference node (or the whole canvas). Use this to place new content without overlapping what's already there.",
    inputSchema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["top", "right", "bottom", "left"],
          description: "Direction to search for empty space.",
        },
        width: { type: "number", description: "Required width of empty space." },
        height: { type: "number", description: "Required height of empty space." },
        padding: { type: "number", description: "Minimum distance from other elements." },
        nodeId: {
          type: "string",
          description: "Reference node to search around. Omit to search around entire canvas content.",
        },
      },
      required: ["direction", "width", "height", "padding"],
      additionalProperties: false,
    },
    annotations: readOnly,
    mutating: false,
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
