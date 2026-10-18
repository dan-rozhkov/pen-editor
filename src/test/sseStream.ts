// AI SDK v6 UI-message-stream (SSE) responses for stubbing `fetch` in chat tests.
const SSE_HEADERS = { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" };

/** A UI-message SSE response from raw chunks (a string chunk is sent verbatim). */
export function sse(chunks: Array<Record<string, unknown> | string>): Response {
  const body = [...chunks, "[DONE]"]
    .map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`)
    .join("");
  return new Response(body, { status: 200, headers: SSE_HEADERS });
}

/** One assistant text turn. */
export const textTurn = (text = "done"): Response =>
  sse([
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish-step" },
    { type: "finish" },
  ]);

/** A response whose body the test pushes chunk by chunk (assert on state before the final chunk). */
export function controlledSse() {
  const encoder = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => (ctl = c) });
  return {
    response: new Response(stream, { status: 200, headers: SSE_HEADERS }),
    push: (chunk: Record<string, unknown>) => ctl.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)),
    close: () => {
      ctl.enqueue(encoder.encode("data: [DONE]\n\n"));
      ctl.close();
    },
  };
}
