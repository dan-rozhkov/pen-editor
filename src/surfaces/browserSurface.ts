import type { Surface } from "@sideform/agent-harness/surface";
import { applyLoopGuard } from "@sideform/browser-agent/loop";
import { browseOpen } from "@/lib/tools/browser/browseOpen";
import { browseAct } from "@/lib/tools/browser/browseAct";
import { browseFindImages } from "@/lib/tools/browser/browseFindImages";
import { browseRead } from "@/lib/tools/browser/browseRead";
import { browseCapture } from "@/lib/tools/browser/browseCapture";
import { browseFillLogin } from "@/lib/tools/browser/browseFillLogin";
import { browseSnapshot } from "@/lib/tools/browser/browseSnapshot";
import { browseScreenshot } from "@/lib/tools/browser/browseScreenshot";
import { browseTabs } from "@/lib/tools/browser/browseTabs";
import { browseTask } from "@/lib/tools/browser/browseTask";
import { browseAgent } from "@/lib/tools/browser/browseAgent";
import { browserMeta } from "./meta";
import type { ToolExecutionContext, ToolHandler } from "./toolTypes";

/**
 * Wraps a browse_* handler with the loop guard (browse-speed-contract.md,
 * "Frontend" item 5 — see loopGuard in @sideform/browser-agent/loop). Applied here,
 * once, at registration — rather than inside each browse_* module — so
 * every entry point that runs a browse_* call (chat, both MCP bridges,
 * WebMCP) gets it for free, the same way `runToolCall`'s mutual exclusion
 * already does for `executeToolCall` callers. Keyed by
 * `context?.sessionId` when the caller has one (a chat turn); falls back to
 * loopGuard's own module-level ring for the rest (direct MCP bridge calls
 * have no chat session).
 */
function withBrowseLoopGuard(toolName: string, handler: ToolHandler): ToolHandler {
  return async (args, context) => {
    const result = await handler(args, context);
    return applyLoopGuard(toolName, args, result, context?.browserSession ?? context?.sessionId);
  };
}

/**
 * The agent's browser: the Steel cloud browser on the web, a native tab in the
 * desktop shell. NOTE: the tool set per surface is metadata for now; every
 * tool of every surface is still sent to and allowed for the agent, because
 * the agent needs browse tools while the canvas is showing (see the "Surfaces"
 * section of CLAUDE.md).
 */
export const browserSurface = {
  ...browserMeta,
  tools: {
  // Client-executed. They run against the desktop shell's browser tab
  // (window.penDesktop.browser) or, on the web, the Steel cloud browser (see
  // getBrowserBridge). Which of them the backend offers per request comes from
  // CLIENT_CAPABILITIES in lib/chatTransport.ts. Deliberately NOT in
  // mcpToolNames.ts, since these are chat-path tools, not part of the
  // desktop-MCP/WebMCP surface. See docs/superpowers/specs/
  // 2026-09-18-builtin-browser-design.md.
  browse_open: withBrowseLoopGuard("browse_open", browseOpen),
  browse_act: withBrowseLoopGuard("browse_act", browseAct),
  browse_find_images: withBrowseLoopGuard("browse_find_images", browseFindImages),
  browse_read: withBrowseLoopGuard("browse_read", browseRead),
  // browse_snapshot/browse_screenshot/browse_tabs (docs/superpowers/specs/
  // 2026-09-23-full-browser-use-design.md) — full-browser-use additions:
  // an indexed element table exposed directly to the main model, a viewport
  // capture (optionally set-of-marks annotated), and tab list/switch/close/
  // open. Same conventions as the browse_* siblings above.
  browse_snapshot: withBrowseLoopGuard("browse_snapshot", browseSnapshot),
  browse_screenshot: withBrowseLoopGuard("browse_screenshot", browseScreenshot),
  browse_tabs: withBrowseLoopGuard("browse_tabs", browseTabs),
  // browse_capture: the page as one editable embed on the canvas (pen-editor-backend
  // docs/specs/2026-10-15-browse-capture-design.md).
  browse_capture: withBrowseLoopGuard("browse_capture", browseCapture),
  // browse_fill_login: saved logins (desktop shell) (docs/superpowers/specs/
  // 2026-10-16-browser-saved-logins-design.md in pen-editor-desktop).
  browse_fill_login: withBrowseLoopGuard("browse_fill_login", browseFillLogin),
  // Jev-driven browsing loop (docs/superpowers/specs/
  // 2026-09-18-browse-task-jev-loop-design.md) — a client-side loop, not a
  // single forwarded call. See browseTask.ts's header comment.
  browse_task: withBrowseLoopGuard("browse_task", browseTask),
  // browse_agent (pen-editor-backend docs/specs/2026-10-14-browse-subagent-
  // design.md) is deliberately NOT loop-guarded: it is a whole task, not one
  // browser action, and the guard keys on (tool, args) repetition. Its nested
  // browse_* calls already pass through the guarded handlers above, under the
  // parent's sessionId, so loops inside the sub-agent are still caught.
  browse_agent: browseAgent,
  // qa_verdict: browseAgent answers it locally inside a QA run. This entry
  // keeps the tool-name contract whole and refuses a call from the main chat.
  qa_verdict: async () => JSON.stringify({ error: "qa_verdict is only available inside a browse_agent QA run" }),
  qa_assert: async () => JSON.stringify({ error: "qa_assert is only available inside a browse_agent QA run" }),
  },
} satisfies Surface<ToolExecutionContext>;
