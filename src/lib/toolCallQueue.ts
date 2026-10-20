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
import { createSerialQueue } from "@sideform/agent-harness/executor";

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
  // Panel-local (canvasLink): binds the chat to a canvas tab of the desktop agent panel. It
  // touches no scene, and a cold tab load can take many seconds, which would stall every
  // scene-mutating call behind it.
  "open_canvas_tab",
  // Panel-local markdown documents (docs/docStore.ts): localStorage only, no scene. doc_create /
  // doc_open wait for the shell to open a tab, which must not stall scene-mutating calls.
  "doc_list",
  "doc_create",
  "doc_read",
  "doc_edit",
  "doc_open",
  // Panel-local trace tabs: read-only bridge calls, no scene.
  "trace_list",
  "trace_read",
  // The three browse_* tools (docs/superpowers/specs/2026-09-18-builtin-
  // browser-design.md) are thin forwarders onto the desktop shell's
  // BrowserController — they never touch the scene graph. `browse_open` in
  // particular can hold the desktop shell's 20s command timeout on a slow
  // page, which would otherwise stall every scene-mutating call from WebMCP,
  // a plugin or the desktop MCP bridge behind it for that whole window.
  "browse_open",
  "browse_act",
  "browse_find_images",
  // browse_read (Addendum 2, §2 of the same design doc) is the same kind of
  // thin forwarder — it holds its connection while a page settles, and
  // never touches the scene graph.
  "browse_read",
  // browse_snapshot/browse_screenshot/browse_tabs (docs/superpowers/specs/
  // 2026-09-23-full-browser-use-design.md) are the same kind of thin
  // forwarder as the four browse_* tools above — they read/control the
  // browser tab (element table, a pixel capture, tab list/switch/close/open).
  // browse_screenshot with placeOnCanvas:true does write to the scene: it
  // stays unserialized because the capture can take seconds, and queues
  // only its final position-and-addNode step through `runSerialized`.
  "browse_snapshot",
  "browse_screenshot",
  "browse_tabs",
  // browse_capture writes one embed to the scene like browse_screenshot's
  // placeOnCanvas: the DOM serialization can take seconds, so only its final
  // position-and-addNode step is queued through `runSerialized`.
  "browse_capture",
  // browse_fill_login only forwards to the desktop browser (snapshot + typing
  // + optional submit); like browse_act it never touches the scene graph.
  "browse_fill_login",
  // browse_task (docs/superpowers/specs/2026-09-18-browse-task-jev-loop-
  // design.md) runs a whole snapshot/step/perform loop bounded by a 90s
  // deadline — it holds its connection far longer than the other three
  // browse_* tools, so serializing it behind the scene-mutation queue would
  // be the worst case of the head-of-line stall this list already exists to
  // avoid.
  "browse_task",
  // browse_agent runs a nested chat whose own browse_* calls go through this
  // same queue's funnel; they are unserialized, but a serialized parent would
  // still hold every scene-mutating call behind it for minutes.
  "browse_agent",
  // qa_verdict is pure (validates its input and returns JSON); it never
  // touches the scene, so it must not wait behind scene writes.
  "qa_verdict",
  "qa_assert",
];

const unserialized = new Set(UNSERIALIZED_TOOL_NAMES);

export function isSerializedTool(toolName: string): boolean {
  return !unserialized.has(toolName);
}

const serialize = createSerialQueue();

export function runToolCall<T>(toolName: string, task: () => Promise<T>): Promise<T> {
  if (!isSerializedTool(toolName)) return task();
  return runSerialized(task);
}

/**
 * Queues one scene write from inside an unserialized tool — e.g.
 * browse_screenshot's `placeOnCanvas`, whose seconds-long capture must not
 * hold the queue but whose final `addNode` must not land in the middle of a
 * serialized writer's snapshot-and-commit.
 */
export function runSerialized<T>(task: () => Promise<T>): Promise<T> {
  return serialize(task);
}
