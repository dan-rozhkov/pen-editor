import { afterEach, describe, expect, it, vi } from "vitest";
import { QuiverVectorError, streamQuiverVector } from "../stream";

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function frame(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

function stubFetch(response: Response | Promise<Response>) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamQuiverVector", () => {
  it("resolves with the document from the done frame", async () => {
    const whole = '<svg viewBox="0 0 1 1"><circle r="1"/></svg>';
    stubFetch(
      sseResponse([
        frame({ type: "delta", svg: '<svg viewBox="0 0 1 1">' }),
        frame({ type: "done", svg: whole }),
      ]),
    );
    await expect(streamQuiverVector({ prompt: "a dot" })).resolves.toBe(whole);
  });

  it("reassembles frames split across chunk boundaries", async () => {
    const whole = '<svg viewBox="0 0 1 1"><circle r="1"/></svg>';
    const encoded = frame({ type: "done", svg: whole });
    // Split mid-JSON, which is where token-sized deltas actually land.
    const cut = Math.floor(encoded.length / 2);
    stubFetch(sseResponse([encoded.slice(0, cut), encoded.slice(cut)]));
    await expect(streamQuiverVector({ prompt: "a dot" })).resolves.toBe(whole);
  });

  it("reports progress per finished element, not per delta", async () => {
    const deltas = [
      '<svg viewBox="0 0 10 10">',
      '<rect wid',
      'th="4"/>',
      '<circle r',
      '="1"/>',
      '<path d="M0 0',
    ];
    stubFetch(sseResponse(deltas.map((svg) => frame({ type: "delta", svg }))));

    const progress: number[] = [];
    await streamQuiverVector({
      prompt: "shapes",
      onProgress: (p) => progress.push(p.completeElements),
    });

    // Six deltas, but only two elements ever finished; the trailing `<path`
    // is truncated and must not be reported.
    expect(progress).toEqual([1, 2]);
  });

  it("hands the overlay only parseable documents", async () => {
    stubFetch(
      sseResponse([
        frame({ type: "delta", svg: '<svg viewBox="0 0 10 10"><rect width="4"/>' }),
        frame({ type: "delta", svg: '<path d="m1 2-3' }),
      ]),
    );
    const seen: string[] = [];
    await streamQuiverVector({ prompt: "x", onProgress: (p) => seen.push(p.svg) });
    expect(seen).toHaveLength(1);
    const doc = new DOMParser().parseFromString(seen[0], "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
  });

  it("throws the message from an error frame", async () => {
    stubFetch(
      sseResponse([frame({ type: "error", message: "Invalid API key", code: "invalid_api_key" })]),
    );
    await expect(streamQuiverVector({ prompt: "x" })).rejects.toThrow("Invalid API key");
  });

  it("surfaces the server's message on a non-OK response", async () => {
    stubFetch(
      new Response(JSON.stringify({ error: "Vector generation is not configured" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(streamQuiverVector({ prompt: "x" })).rejects.toThrow(
      "Vector generation is not configured",
    );
  });

  it("falls back to the concatenated deltas when done never arrives", async () => {
    stubFetch(
      sseResponse([
        frame({ type: "delta", svg: '<svg viewBox="0 0 1 1">' }),
        frame({ type: "delta", svg: '<circle r="1"/></svg>' }),
      ]),
    );
    await expect(streamQuiverVector({ prompt: "x" })).resolves.toBe(
      '<svg viewBox="0 0 1 1"><circle r="1"/></svg>',
    );
  });

  it("rejects when the stream yielded nothing", async () => {
    stubFetch(sseResponse([]));
    await expect(streamQuiverVector({ prompt: "x" })).rejects.toBeInstanceOf(QuiverVectorError);
  });

  it("rejects instead of resolving with a truncated document when aborted (finding 6 regression)", async () => {
    // An abort landing between reads used to `return` from the frame
    // generator, ending the `for await` loop normally — `streamQuiverVector`
    // then fell through to `final ?? accumulated` and RESOLVED with
    // whatever partial SVG had streamed in, so a stopped generation would
    // silently "succeed" and let the caller commit a half-drawn document.
    stubFetch(
      sseResponse([
        frame({ type: "delta", svg: '<svg viewBox="0 0 1 1">' }),
        frame({ type: "delta", svg: '<circle r="1"/>' }),
      ]),
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      streamQuiverVector({ prompt: "x", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("ignores a malformed frame instead of failing the generation", async () => {
    const whole = '<svg viewBox="0 0 1 1"><circle r="1"/></svg>';
    stubFetch(
      sseResponse([
        "data: {not json\n\n",
        frame({ type: "done", svg: whole }),
      ]),
    );
    await expect(streamQuiverVector({ prompt: "x" })).resolves.toBe(whole);
  });
});
