import { executeToolCall } from "@/hooks/useDesignChat";
import { toolHandlers } from "@/lib/toolRegistry";
import { canEditScene, useEditorModeStore } from "@/store/editorModeStore";
import { useSharedViewStore } from "@/store/sharedViewStore";
import { claimTool, getModelContext } from "./polyfill";
import { redactForSharedView } from "./sharedViewRedaction";
import { WEBMCP_TOOL_SPECS, type WebMcpToolSpec } from "./schemas";
import type { ModelContextLike, ToolDefinition } from "./types";
import { validateInput } from "./validateInput";

/**
 * Publishes pen-editor's agent-facing tools on the page's model context.
 *
 * Everything here routes through `executeToolCall` — the same entry point
 * the chat agent and both MCP bridges use. No business logic is
 * reimplemented: the handlers in src/lib/tools/ stay authoritative for what
 * a tool does, and this module is only responsible for the contract around
 * them (schema, risk, gating, result shape).
 */

/**
 * Whether an editor is currently mounted and owning this surface.
 *
 * The polyfill has no unregister, by design — neither does the native API —
 * so tools stay published after the editor route unmounts (browser Back from
 * `/app` to the showcase, say). Without this flag they would keep answering:
 * `canEditScene` still reports "edit" and `isSharedView` is still false, so a
 * mutating call would run against a scene store nothing renders. Registration
 * is scoped to the route; this makes execution scoped to it too.
 */
let surfaceActive = false;

/** Called by startWebMcp/stopWebMcp as the editor route mounts and unmounts. */
export function setSurfaceActive(active: boolean): void {
  surfaceActive = active;
}

/** Refusal message used when any tool is called with no editor mounted. */
export const SURFACE_INACTIVE =
  "The pen-editor document surface is not mounted in this tab right now.";

/** Refusal message used when a mutating tool is called on a non-editable canvas. */
export const READ_ONLY_REFUSAL =
  "This canvas is not editable right now (read-only shared view, ?view mode, or present mode); editing tools are unavailable.";

/**
 * Whether the scene may currently be mutated, decided by the application's
 * own rules rather than a copy of them.
 *
 * Two independent things make a canvas non-editable and both must be
 * consulted. `isSharedView` marks the `/c/:shareId` viewer, where the
 * document belongs to someone else. `canEditScene` is the editor's own
 * predicate for its mode — it is what the canvas uses to refuse drag,
 * resize and draw, and it also covers the `?view` URL parameter, which
 * enters view mode on `/app` without ever setting the shared-view flag.
 * Checking only the first would leave `/app?view` fully writable to an
 * agent while the UI showed the user a read-only canvas.
 *
 * The two are not equally strong, and it matters. `isSharedView` is a real
 * boundary: the shared viewer refuses to leave view mode at all. `?view` on
 * your own document is a UI mode — Escape exits it deliberately, and anything
 * that can call these tools can also dispatch a synthetic key event — so
 * gating on it keeps the surface honest about what the page is right now, and
 * is not a defence against a caller that wants to edit.
 */
function canMutateScene(): boolean {
  if (useSharedViewStore.getState().isSharedView) return false;
  return canEditScene(useEditorModeStore.getState().mode);
}

/**
 * A failed tool call, reported as a *result* rather than a rejection.
 *
 * Rejections lose their message: the WebMCP layer replaces it with a generic
 * "Tool invocation failed" (the native API does this, and polyfill.ts mirrors
 * it deliberately). For a protocol-level problem that is fine — there is
 * nothing for the caller to do differently. For a tool-level problem it is
 * destructive: "this canvas is read-only", "your arguments are malformed",
 * and "your script has a syntax error on line 12" all arrive as the same
 * sentence, and none of them can be acted on. `batch_design` is the sharpest
 * case — it reports `completedOperations` and a resume point when a long
 * script fails partway, and that is exactly the information a caller needs to
 * continue rather than restart.
 *
 * Returning `{ isError: true, ... }` is MCP's own convention for this split,
 * and unlike a thrown message it survives every layer between here and the
 * caller, on the polyfill and on a native implementation alike.
 */
export interface ToolErrorResult {
  isError: true;
  error: string;
  [key: string]: unknown;
}

function toolError(message: string): ToolErrorResult {
  return { isError: true, error: message };
}

/**
 * Turns a handler's string result into something structured.
 *
 * `executeToolCall` always resolves — a thrown handler comes back as a
 * resolved `{"error": "..."}` string — so a successful promise here is not
 * yet a successful tool call. Such a result is re-flagged as an error result,
 * with the handler's own fields preserved: a caller that only checks
 * `isError` learns it failed, and one that reads further gets the detail.
 */
function toToolResult(raw: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not every handler returns JSON. A plain string is still a valid,
    // JSON-serializable result.
    return raw;
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    typeof (parsed as { error?: unknown }).error === "string"
  ) {
    return { ...(parsed as Record<string, unknown>), isError: true } as ToolErrorResult;
  }
  return parsed;
}

function buildDefinition(spec: WebMcpToolSpec): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: spec.annotations,
    execute: async (input: unknown) => {
      // Refuse everything, not just the mutating tools, once the editor has
      // gone: a read of a document that is no longer on screen is a lie of a
      // different kind, and this module's whole premise is that the tools
      // exist only where a document does.
      if (!surfaceActive) {
        return toolError(SURFACE_INACTIVE);
      }

      // Re-checked per call, not only at registration. The native API has no
      // way to withdraw a tool once registered, and `/c/:shareId` sets the
      // shared-view flag from a parent effect while the editor it wraps
      // mounts lazily underneath — so registration-time gating alone would
      // be a race. sharedViewStore.ts is explicit that the handlers below
      // mutate the scene stores directly, beneath every UI-level guard, and
      // that the only real protection is removing the way to invoke them.
      // WebMCP is a new way to invoke them, so it has to carry its own.
      if (spec.mutating && !canMutateScene()) {
        return toolError(READ_ONLY_REFUSAL);
      }

      const validation = validateInput(input, spec.inputSchema);
      if (!validation.ok) {
        // Every problem, not just the first: a caller fixing one field at a
        // time across round trips is the slow way to learn a schema.
        return toolError(
          `Invalid input for ${spec.name}: ${validation.errors.join("; ")}`
        );
      }

      // Not queued here: `executeToolCall` runs every mutating call through
      // the shared queue itself (toolCallQueue.ts). Wrapping again would
      // deadlock — the inner call would wait on the queue this one holds.
      const raw = await executeToolCall(spec.name, validation.value, undefined, "webmcp");
      const result = toToolResult(raw);

      // Someone else's document is narrowed to what their viewer can draw,
      // so a share link cannot smuggle text past the victim's eyes into
      // their agent. Applied to the result rather than inside the handlers:
      // the handlers are shared with chat and the MCP bridges, which operate
      // on the user's own document and must keep seeing all of it.
      // Deliberately after the error check above — an error result carries no
      // document content, only our own message.
      return useSharedViewStore.getState().isSharedView
        ? redactForSharedView(result)
        : result;
    },
  };
}

export interface RegistrationResult {
  registered: string[];
  /** Tools withheld because the canvas was not editable at registration. */
  withheld: string[];
}

/**
 * Registers the tool set appropriate to the current document.
 *
 * On a canvas that cannot be edited, the mutating tools are not merely
 * refused at call time, they are never advertised: a tool that appears in
 * discovery and then always fails wastes an agent's turn and misrepresents
 * what the page can do. The call-time refusal in `execute` stays as the
 * guarantee — editability can change after registration, and there is no way
 * to withdraw a registered tool — while this is the honest advertisement of
 * what the page could do when it came up.
 */
export async function registerWebMcpTools(
  context: ModelContextLike | undefined = getModelContext()
): Promise<RegistrationResult> {
  const result: RegistrationResult = { registered: [], withheld: [] };
  if (!context) return result;

  // Checked for the whole list before anything is registered. Throwing from
  // inside the loop would leave the page advertising a partial tool set while
  // the caller reported a clean failure — worse than either outcome alone.
  const unbacked = WEBMCP_TOOL_SPECS.filter(
    (spec) => !Object.prototype.hasOwnProperty.call(toolHandlers, spec.name)
  ).map((spec) => spec.name);
  if (unbacked.length > 0) {
    throw new Error(`WebMCP specs reference unknown tools: ${unbacked.join(", ")}`);
  }

  const mutable = canMutateScene();

  for (const spec of WEBMCP_TOOL_SPECS) {
    if (spec.mutating && !mutable) {
      result.withheld.push(spec.name);
      continue;
    }
    await context.registerTool(claimTool(buildDefinition(spec)));
    result.registered.push(spec.name);
  }

  return result;
}
