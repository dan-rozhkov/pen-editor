import { runBrowseTask } from "@sideform/browser-agent/loop";
import type { ToolHandler } from "../../toolRegistry";
import { getBrowserAgentPermissions } from "@/store/browserAgentSettingsStore";
import { browseBackend } from "./backend";
import { getBrowserBridge, isDesktopBrowserAvailable } from "./bridge";
import { BROWSER_NOT_AVAILABLE_ERROR } from "./shared";

/**
 * browse_task — a Jev-driven browsing loop. The loop itself (snapshot → POST
 * /api/browse/step → perform, sub-goal planning, action cache, deadlines)
 * lives in `@sideform/browser-agent/loop`; this handler is the glue that
 * feeds it this app's bridge, backend, settings and abort signal. Its own
 * time bound (`browseTaskInnerBoundMs`) is the REAL bound on the call; the
 * chat-side tool-call timeout (useDesignChat.ts) is only a margin above it.
 */

/** Experiment flag: send a marked screenshot of the step's snapshot to the backend. */
export function browseStepScreenshotEnabled(): boolean {
  return import.meta.env.VITE_BROWSE_STEP_SCREENSHOT === "true";
}

/** `localStorage` can throw on access (blocked site data); the loop then runs without the action cache. */
function safeLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const browseTask: ToolHandler = async (args, context) => {
  const browser = getBrowserBridge(context?.sessionId);
  if (!browser) {
    return JSON.stringify({ error: BROWSER_NOT_AVAILABLE_ERROR });
  }

  const goal = typeof args.goal === "string" ? args.goal : "";
  const maxSteps =
    typeof args.maxSteps === "number" && Number.isFinite(args.maxSteps) ? args.maxSteps : undefined;
  const url = typeof args.url === "string" && args.url.length > 0 ? args.url : undefined;

  try {
    const transcript = await runBrowseTask(goal, {
      browser,
      backend: browseBackend,
      permissions: getBrowserAgentPermissions,
      storage: safeLocalStorage(),
      cloud: !isDesktopBrowserAvailable(),
      stepScreenshots: browseStepScreenshotEnabled(),
      signal: context?.signal,
      maxSteps,
      url,
    });
    // Always a real JSON string (ToolHandler contract), even for a nullish transcript.
    return JSON.stringify(transcript ?? {});
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : "browse_task failed.",
    });
  }
};
