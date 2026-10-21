import type { ToolHandler } from "../../toolRegistry";
import {
  executeBrowseTool,
  runActionsBatch as runPackageActionsBatch,
  type ElementLocator,
  type ExecuteBrowseToolOptions,
} from "@sideform/browser-agent/agent/execute";
import { BACKEND_MAX_DESCRIPTION, fetchBrowseBackend, sanitizedPageBody, truncateToChars } from "@sideform/browser-agent/loop";
import { getBrowserBridge } from "./bridge";
import { browseBackend } from "./backend";
import { peBase, withSecrets, type PenDesktopBrowser } from "./shared";

/**
 * browse_act — the routing, the batch and the snapshot rules live in the
 * package (`@sideform/browser-agent/agent/execute`). What stays here is the
 * natural-language `element` locator: it calls the backend's
 * `/api/browse/locate` with a fresh snapshot and returns the index.
 */

/** browse_act's locate call, retries included, must finish inside the default
 * tool-call timeout (30 s, useDesignChat.ts). */
const LOCATE_RETRY_BUDGET_MS = 25_000;

/**
 * `/api/browse/locate`'s `operation` field reuses browse_task's step
 * vocabulary so the backend can share its element-matching prompt with the Jev
 * loop. `press` locates as FOCUS, not CLICK: a key can target a button, a text
 * input or a `<select>` alike, and CLICK-only candidates could never match a
 * text input, which is where Enter is usually pressed.
 */
const ACTION_TO_LOCATE_OPERATION: Record<string, string> = {
  click: "CLICK",
  type: "TYPE_TEXT",
  select: "SELECT",
  hover: "HOVER",
  // The target is a file input, its label or a drop zone: a clickable candidate.
  upload: "CLICK",
  press: "FOCUS",
};

interface LocateResponse {
  outcome?: "found" | "not_found" | "retry";
  index?: number;
  label?: string;
  confidence?: number;
  model?: string;
  reason?: string;
}

const locateElement: ElementLocator = async ({ element, action, snapshot }) => {
  let located: LocateResponse;
  try {
    const res = await fetchBrowseBackend(
      browseBackend,
      "/api/browse/locate",
      {
        description: truncateToChars(element, BACKEND_MAX_DESCRIPTION),
        operation: ACTION_TO_LOCATE_OPERATION[action] ?? "CLICK",
        ...sanitizedPageBody(snapshot),
      },
      undefined,
      undefined,
      {
        now: () => Date.now(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        // Stay inside browse_act's own tool-call budget: the fit check lets a
        // 429 retry happen only while wait + request timeout still ends by then.
        deadline: Date.now() + LOCATE_RETRY_BUDGET_MS,
      },
    );
    if (res.status === 503) {
      return {
        outcome: "failed",
        message: `browse_act: element targeting is not available (no fast model configured on the backend). Use target or index instead.`,
      };
    }
    if (!res.ok) {
      return {
        outcome: "failed",
        message: `browse_act: /api/browse/locate responded ${res.status} while resolving "${element}". Use target or index instead.`,
      };
    }
    located = (res.body ?? {}) as LocateResponse;
  } catch (err) {
    return {
      outcome: "failed",
      message: `browse_act: /api/browse/locate failed while resolving "${element}" (${
        err instanceof Error ? err.message : String(err)
      }). Use target or index instead.`,
    };
  }

  if (located.outcome === "found" && typeof located.index === "number") {
    return { outcome: "found", index: located.index, label: located.label, confidence: located.confidence };
  }
  if (located.outcome === "not_found") return { outcome: "not_found", reason: located.reason };
  // "retry", or anything else unrecognized (a `found` without a numeric index too).
  return { outcome: "retry", reason: located.reason };
};

const actOptions: ExecuteBrowseToolOptions = {
  ...peBase,
  locateElement,
  elementActions: Object.keys(ACTION_TO_LOCATE_OPERATION),
};

/**
 * Runs `actions` in order (see the package's `runActionsBatch`). `now` is the
 * injectable clock for the 60 s batch deadline (default: Date.now).
 */
export function runActionsBatch(
  browser: PenDesktopBrowser | undefined,
  actionsRaw: unknown[],
  topSnapshotId: string | undefined,
  now?: () => number,
): Promise<string> {
  return runPackageActionsBatch(browser, actionsRaw, topSnapshotId, now, actOptions);
}

export const browseAct: ToolHandler = (args, context) =>
  executeBrowseTool(getBrowserBridge(context?.sessionId, context?.browserSession), "browse_act", args, withSecrets(actOptions, context?.sessionId));
