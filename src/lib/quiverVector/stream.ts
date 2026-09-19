import { isOffline, resolveApiUrl } from "@/lib/apiBase";
import { buildRenderableSvgPrefix } from "./svgStreamPrefix";

/**
 * Browser half of `generate_vector`.
 *
 * The QuiverAI key is a paid live credential and stays on our backend, so this
 * talks to `/api/vector/generate`, which proxies the upstream SSE stream. The
 * frame vocabulary is ours, not Quiver's: the route normalizes upstream's
 * `draft`/`content` events into `delta`/`done`/`error`.
 */

export interface QuiverVectorProgress {
  /** A well-formed SVG document covering every element that has fully arrived. */
  svg: string;
  /** How many top-level elements it contains. */
  completeElements: number;
}

export interface StreamQuiverVectorOptions {
  prompt: string;
  instructions?: string;
  /**
   * Called only when a new element finishes, never per delta. Quiver sends
   * ~270 deltas for a simple icon and the overlay rasterizes each frame, so
   * redrawing per delta would burn the main thread to show the same picture.
   */
  onProgress?: (progress: QuiverVectorProgress) => void;
  signal?: AbortSignal;
}

/** A `DOMException("AbortError")`, matching what a `fetch`/`AbortController`
 * abort itself produces, so callers can distinguish "the user cancelled"
 * from an ordinary failure with the same `err.name === "AbortError"` check
 * used elsewhere in this codebase (`describeNetworkError` in
 * `lib/tools/repoToolRequest.ts`). */
function createAbortError(): DOMException {
  return new DOMException("Vector generation was aborted", "AbortError");
}

export class QuiverVectorError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "QuiverVectorError";
    this.code = code;
  }
}

interface ServerFrame {
  type?: string;
  svg?: string;
  message?: string;
  code?: string;
}

/**
 * Split an SSE byte stream into frames.
 *
 * Records are separated by a blank line, and a chunk boundary lands anywhere —
 * very often mid-record, since deltas are token-sized. Leftover text is carried
 * to the next chunk rather than parsed early.
 */
async function* readSseFrames(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<ServerFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      // Must THROW, not return: a plain `return` ends the generator (and the
      // `for await` in `streamQuiverVector`) normally, which then falls
      // through to `final ?? accumulated` and *resolves* with whatever
      // truncated prefix had arrived so far — a stopped generation would
      // silently succeed and commit a half-drawn document.
      if (signal?.aborted) throw createAbortError();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Accept \n\n and \r\n\r\n; proxies rewrite line endings.
      let separator = findSeparator(buffer);
      while (separator !== null) {
        const record = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        const frame = parseRecord(record);
        if (frame !== null) yield frame;
        separator = findSeparator(buffer);
      }
    }
    const tail = parseRecord(buffer);
    if (tail !== null) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function findSeparator(buffer: string): { index: number; length: number } | null {
  const crlf = buffer.indexOf("\r\n\r\n");
  const lf = buffer.indexOf("\n\n");
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  if (lf !== -1) return { index: lf, length: 2 };
  return null;
}

/** Concatenate a record's `data:` lines; ignore `event:`/`id:`/comments. */
function parseRecord(record: string): ServerFrame | null {
  const data = record
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (data.length === 0) return null;
  try {
    return JSON.parse(data) as ServerFrame;
  } catch {
    // A malformed frame is not worth failing a 90-second generation over.
    return null;
  }
}

/** Read an error body without letting a non-JSON page become the message. */
async function describeFailure(response: Response): Promise<QuiverVectorError> {
  let message = `Vector generation failed (HTTP ${response.status})`;
  let code: string | undefined;
  try {
    const body = (await response.json()) as { error?: string; message?: string; code?: string };
    const detail = body.error ?? body.message;
    if (typeof detail === "string" && detail.length > 0) message = detail;
    code = body.code;
  } catch {
    // Keep the status-based message.
  }
  return new QuiverVectorError(message, code);
}

/**
 * Run one generation, reporting each finished element, and resolve with the
 * complete SVG document.
 */
export async function streamQuiverVector(
  options: StreamQuiverVectorOptions,
): Promise<string> {
  // Fail immediately rather than letting a 90-second generation hang before
  // the browser notices there is no connection. There is no offline fallback:
  // the model that draws the artwork lives behind our backend.
  if (isOffline()) {
    throw new QuiverVectorError(
      "Offline: vector generation requires a network connection.",
    );
  }

  const response = await fetch(resolveApiUrl("/api/vector/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: options.prompt,
      ...(options.instructions ? { instructions: options.instructions } : {}),
    }),
    signal: options.signal,
  });

  if (!response.ok) throw await describeFailure(response);
  if (response.body === null) {
    throw new QuiverVectorError("Vector generation returned an empty response");
  }

  let accumulated = "";
  let lastElementCount = 0;
  let final: string | null = null;

  for await (const frame of readSseFrames(response.body, options.signal)) {
    if (frame.type === "error") {
      throw new QuiverVectorError(
        frame.message ?? "Vector generation failed",
        frame.code,
      );
    }
    if (frame.type === "done") {
      // `done` carries the whole document, not a delta.
      if (typeof frame.svg === "string" && frame.svg.length > 0) final = frame.svg;
      break;
    }
    if (frame.type !== "delta" || typeof frame.svg !== "string") continue;

    accumulated += frame.svg;
    if (options.onProgress === undefined) continue;

    const prefix = buildRenderableSvgPrefix(accumulated);
    if (prefix.svg === null || prefix.completeElements === lastElementCount) continue;
    lastElementCount = prefix.completeElements;
    options.onProgress({ svg: prefix.svg, completeElements: prefix.completeElements });
  }

  // A stream that ends without `done` still drew something; fall back to what
  // arrived rather than discarding a generation that cost ~90 seconds.
  const result = final ?? accumulated;
  if (result.trim().length === 0) {
    throw new QuiverVectorError("Vector generation produced no SVG");
  }
  return result;
}
