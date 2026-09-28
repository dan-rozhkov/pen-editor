import { expect, type Page } from "@playwright/test";
import { SSE_HEADERS } from "./sse";

// Chunk-by-chunk /api/chat stub shared by the streaming-tool specs.
// page.route's fulfill() only accepts a complete body, so it can't deliver a
// tool call over real time. This installs a `window.fetch` override (via
// page.addInitScript) that answers /api/chat with a Response backed by a real
// ReadableStream whose controller the test pushes into directly
// (window.__chatControllers[i].push/close).
export async function installChatStreamStub(page: Page): Promise<void> {
  // The init script runs in the page, so closures don't cross over: pass the headers as an arg.
  await page.addInitScript((sseHeaders) => {
    const w = window as unknown as {
      __chatRequests: unknown[];
      __chatControllers: Array<{
        push: (chunk: Record<string, unknown>) => void;
        close: () => void;
      }>;
      __chatAborted: boolean[];
    };
    w.__chatRequests = [];
    w.__chatControllers = [];
    w.__chatAborted = [];
    const encoder = new TextEncoder();
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.includes("/api/models")) {
        return new Response(
          JSON.stringify({
            models: [
              { id: "test/vector-model", label: "Vector Model", supportsVision: true },
            ],
            default: "test/vector-model",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.includes("/api/chat")) {
        w.__chatRequests.push(init?.body ? JSON.parse(String(init.body)) : null);
        const index = w.__chatRequests.length - 1;

        let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controllerRef = controller;
          },
        });
        w.__chatControllers[index] = {
          push(chunk) {
            controllerRef!.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          },
          close() {
            controllerRef!.enqueue(encoder.encode("data: [DONE]\n\n"));
            controllerRef!.close();
          },
        };
        w.__chatAborted[index] = false;
        init?.signal?.addEventListener("abort", () => {
          w.__chatAborted[index] = true;
        });

        return new Response(stream, {
          status: 200,
          headers: sseHeaders,
        });
      }

      return originalFetch(input, init);
    };
  }, SSE_HEADERS);
}

export async function push(page: Page, index: number, chunk: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ index, chunk }) => {
      (window as unknown as { __chatControllers: Array<{ push: (c: Record<string, unknown>) => void }> })
        .__chatControllers[index].push(chunk);
    },
    { index, chunk }
  );
}

export async function closeStream(page: Page, index: number): Promise<void> {
  await page.evaluate((index) => {
    (window as unknown as { __chatControllers: Array<{ close: () => void }> })
      .__chatControllers[index].close();
  }, index);
}

export async function waitForRequestCount(page: Page, count: number): Promise<void> {
  await page.waitForFunction(
    (count) =>
      (window as unknown as { __chatRequests: unknown[] }).__chatRequests.length >= count,
    count
  );
}

export async function openChatAndSend(page: Page, message: string): Promise<void> {
  await page.getByTestId("rail-agents").click();
  await expect(page.getByText("Design Agent", { exact: true })).toBeVisible();
  const input = page.getByPlaceholder("Ask the design agent...");
  await input.fill(message);
  await input.press("Enter");
}


/** Answers stream `index` (an auto-continuation) with a plain text reply and closes it. */
export async function replyWithText(page: Page, index: number, text: string): Promise<void> {
  await push(page, index, { type: "start" });
  await push(page, index, { type: "start-step" });
  await push(page, index, { type: "text-start", id: "t2" });
  await push(page, index, { type: "text-delta", id: "t2", delta: text });
  await push(page, index, { type: "text-end", id: "t2" });
  await push(page, index, { type: "finish-step" });
  await push(page, index, { type: "finish" });
  await closeStream(page, index);
}
