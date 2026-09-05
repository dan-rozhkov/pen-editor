/**
 * The serialization point for every tool call that can mutate the scene.
 *
 * Why it lives in its own module rather than in mcpDispatch.ts: the queue has
 * to wrap `executeToolCall` (useDesignChat.ts) so chat, both MCP bridges and
 * the WebMCP surface all inherit it, and mcpDispatch already imports
 * `executeToolCall`. Putting the queue there would make useDesignChat import
 * back into mcpDispatch — a cycle. This module imports nothing.
 *
 * Why it exists at all: the scene-mutating handlers (batch_design above all)
 * build their result from a snapshot of `useSceneStore.getState()` and then
 * commit a whole replacement `nodesById`/`childrenById`/`rootIds`. Two of
 * them in flight at once means the second commit silently discards the
 * first's nodes. That used to be prevented by arrangement — one serial queue
 * per transport, and the two bridges were mutually exclusive — but chat, the
 * WebMCP surface and plugins are all reachable at the same time in a single
 * editor tab, so the guarantee has to sit below all of them.
 */

/**
 * Tools that skip the queue because they cannot change the scene.
 *
 * The default is to serialize: anything not named here waits its turn, so a
 * newly added tool is safe until someone has decided it is a reader. That
 * direction matters — the cost of wrongly serializing a read is latency, the
 * cost of wrongly parallelizing a write is lost work.
 *
 * The list exists because a global queue otherwise couples transports that
 * share nothing. The case that forced it: `get_screenshot` in a backgrounded
 * tab, where `requestAnimationFrame` never fires and the call burns its full
 * timeout — with every read serialized, that stalls unrelated bridge traffic
 * for the whole window.
 */
export const UNSERIALIZED_TOOL_NAMES: readonly string[] = [
  "get_editor_state",
  "batch_get",
  "snapshot_layout",
  "get_variables",
  "get_screenshot",
  "get_text_styles",
  "get_styles",
  "search_all_unique_properties",
  "find_empty_space_on_canvas",
  "read_embed_html",
  "read_comments",
  "list_plugins",
  "get_guidelines",
  "get_style_guide_tags",
  "get_style_guide",
  // Pure network reads against the backend's GitHub proxy — nothing they can
  // touch is in the scene graph, and each holds its connection for up to 25s,
  // which is exactly the window that would stall unrelated bridge traffic.
  "read_design_repo",
  "read_repo_files",
];

const unserialized = new Set(UNSERIALIZED_TOOL_NAMES);

export function isSerializedTool(toolName: string): boolean {
  return !unserialized.has(toolName);
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs `task` after every previously queued mutating call has settled.
 * Read-only tools run immediately and neither wait nor make others wait.
 *
 * A rejected task must not poison the queue for everything behind it, hence
 * the two-argument `then` and the swallowed tail.
 */
export function runToolCall<T>(toolName: string, task: () => Promise<T>): Promise<T> {
  if (!isSerializedTool(toolName)) return task();

  const result = queue.then(task, task);
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
