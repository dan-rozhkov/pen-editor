import type { Page } from "@playwright/test";
import { SSE_HEADERS, sseBody } from "./sse";

// Shared stubs for the two backend endpoints every chat-driving spec fakes:
// GET /api/models (fetched once at startup) and POST /api/chat (the SSE
// turn(s) the AI SDK v6 stream carries). Consolidated here so the exact
// model id/shape and request-capture plumbing can't drift between specs that
// stub the same wire format (chat-smoke, plugin-ai-generation,
// mobile-chat-history, and the embed-element specs that open a real chat).

const DEFAULT_MODELS_RESPONSE = {
  models: [{ id: "test/smoke-model", label: "Smoke Model", supportsVision: true }],
  default: "test/smoke-model",
};

/** Stubs GET /api/models with a single deterministic model. The app fetches
 * this at startup and silently falls back on failure, but stubbing it avoids
 * a 404 (and the resulting slowdown) in the dev server on every spec run. */
export async function stubModels(page: Page): Promise<void> {
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: DEFAULT_MODELS_RESPONSE }),
  );
}

export interface ChatRequestBody {
  canvasContext?: unknown;
  messages?: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
}

/**
 * Stubs POST /api/chat so each request in sequence is answered with the next
 * turn from `turns` (each turn an array of AI SDK v6 SSE chunks, as built by
 * `sseBody`); once `turns` is exhausted, the last turn repeats. Returns the
 * live array of parsed request bodies, so the spec can assert request
 * count/content the same way it always has, without owning the route.
 */
export async function stubChatTurns(
  page: Page,
  turns: Array<Array<Record<string, unknown>>>,
): Promise<ChatRequestBody[]> {
  const requests: ChatRequestBody[] = [];
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON() as ChatRequestBody;
    requests.push(body);
    const turn = turns[Math.min(requests.length - 1, turns.length - 1)];
    await route.fulfill({ headers: SSE_HEADERS, body: sseBody(turn) });
  });
  return requests;
}

/** Opens the Agents (chat) section from the left rail. Mechanics only — the
 * spec asserts on visibility of whatever it expects to appear. */
export async function openAgentsRail(page: Page): Promise<void> {
  await page.getByTestId("rail-agents").click();
}

/** Fills the chat composer and submits with Enter. */
export async function sendChatMessage(page: Page, text: string): Promise<void> {
  const input = page.getByPlaceholder("Ask the design agent...");
  await input.fill(text);
  await input.press("Enter");
}
