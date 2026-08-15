// Publishes screens the user built on this canvas to the public showcase
// gallery (`POST /api/showcase/publish`, backend-owned). This is the
// *rasterizing* half of the round trip: the backend has no headless browser
// in production, so unlike `showcase:generate`'s own agent runs (which
// harvest `htmlContent` and screenshot it with Playwright server-side), a
// user-published screen has to be rendered to pixels here, in the browser,
// where it's already on screen. It is the inverse of
// `src/lib/importShowcaseScreens.ts`, which pulls gallery screens *back*
// into the editor as embed nodes — read that file for the other direction
// of this handoff.
//
// This file is a thin adapter: it only makes sense of the model's
// loosely-typed tool-call args (including the defensive JSON-string
// `screens` parse below) and maps the outcome onto the JSON strings the
// tool-call protocol expects. The actual pipeline — validation, size
// checks, HTML extraction, rasterization, POST — lives once, shared with
// the "Publish to Showcase" panel button, in `src/lib/showcasePublish.ts`.
import {
  publishScreensToShowcase,
  type ShowcasePlatform,
  type ShowcasePublishScreen,
} from "@/lib/showcasePublish";
import type { ToolHandler } from "../toolRegistry";

const MAX_SCREENS = 5;

interface ParsedArgs {
  theme: string;
  prompt?: string;
  platform?: ShowcasePlatform;
  screens: ShowcasePublishScreen[];
}

/** Coerce the raw tool args into a validated shape, or an error string. */
function parseArgs(raw: Record<string, unknown>): ParsedArgs | { error: string } {
  const theme = raw.theme;
  if (typeof theme !== "string" || theme.trim().length === 0) {
    return { error: "theme is required" };
  }

  const prompt = typeof raw.prompt === "string" ? raw.prompt : undefined;

  let platform: ShowcasePlatform | undefined;
  if (raw.platform !== undefined) {
    if (raw.platform !== "mobile" && raw.platform !== "desktop") {
      return { error: `Invalid platform "${String(raw.platform)}" — must be "mobile" or "desktop"` };
    }
    platform = raw.platform;
  }

  let rawScreens = raw.screens;
  if (typeof rawScreens === "string") {
    try {
      rawScreens = JSON.parse(rawScreens);
    } catch {
      return { error: "screens could not be parsed as JSON" };
    }
  }
  if (!Array.isArray(rawScreens) || rawScreens.length === 0) {
    return { error: "screens is required and must be a non-empty array" };
  }
  if (rawScreens.length > MAX_SCREENS) {
    return { error: `Too many screens: ${rawScreens.length} (max ${MAX_SCREENS})` };
  }

  const screens: ShowcasePublishScreen[] = [];
  let coverCount = 0;
  for (let i = 0; i < rawScreens.length; i++) {
    const item = rawScreens[i];
    if (!item || typeof item !== "object") {
      return { error: `screens[${i}] is not an object` };
    }
    const { nodeId, title, cover } = item as Record<string, unknown>;
    if (typeof nodeId !== "string" || nodeId.length === 0) {
      return { error: `screens[${i}] is missing nodeId` };
    }
    if (typeof title !== "string" || title.trim().length === 0) {
      return { error: `screens[${i}] is missing title` };
    }
    const isCover = cover === true;
    if (isCover) coverCount += 1;
    screens.push({ nodeId, title: title.trim(), cover: isCover });
  }
  if (coverCount > 1) {
    return { error: "Only one screen may have cover: true" };
  }

  return { theme: theme.trim(), prompt, platform, screens };
}

export const publishToShowcase: ToolHandler = async (args) => {
  const parsed = parseArgs(args);
  if ("error" in parsed) {
    return JSON.stringify({ error: parsed.error });
  }

  const outcome = await publishScreensToShowcase(parsed);
  if (!outcome.ok) {
    return JSON.stringify({ error: outcome.error });
  }

  return JSON.stringify({
    published: outcome.screens.length,
    runId: outcome.runId,
    theme: outcome.theme,
    screens: outcome.screens,
  });
};
