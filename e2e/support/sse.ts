// Shared helpers for specs that stub /api/chat with an AI SDK v6 UI message
// stream (SSE) via page.route. Used by chat-smoke.spec.ts and
// plugin-ai-generation.spec.ts so the headers/framing can't drift between
// specs that stub the same wire format.

export const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "x-vercel-ai-ui-message-stream": "v1",
};

export function sseBody(chunks: Array<Record<string, unknown>>): string {
  return (
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
    "data: [DONE]\n\n"
  );
}
