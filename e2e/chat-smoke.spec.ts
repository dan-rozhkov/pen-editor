import { test, expect } from "@playwright/test";

// Smoke test for the AI design chat. The backend is stubbed via page.route:
// the first /api/chat request streams assistant text plus a batch_design tool
// call (AI SDK v6 UI message stream / SSE), the tool executes locally in the
// browser against the Zustand scene graph, and the resulting tool output
// triggers an automatic follow-up request which we answer with final text.

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "x-vercel-ai-ui-message-stream": "v1",
};

function sseBody(chunks: Array<Record<string, unknown>>): string {
  return (
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
    "data: [DONE]\n\n"
  );
}

// batch_design DSL: insert a root frame with a unique, easy-to-spot name.
const BATCH_DESIGN_OPERATIONS =
  'f=I(document, {type: "frame", name: "SmokeTestFrame", width: 400, height: 300, fill: "#ffccdd"})';

const FIRST_TURN_TEXT = "Adding a frame to the canvas now.";
const FINAL_TURN_TEXT = "The frame has been created. Smoke test complete.";

interface ChatRequestBody {
  canvasContext?: unknown;
  model?: unknown;
  messages?: Array<{
    role: string;
    parts: Array<Record<string, unknown>>;
  }>;
}

test("AI chat streams a batch_design tool call, executes it locally and auto-continues", async ({
  page,
}) => {
  const chatRequests: ChatRequestBody[] = [];

  // Keep the model list deterministic (the app fetches it at startup and
  // silently falls back on failure; stubbing avoids a 404 in the dev server).
  await page.route("**/api/models", (route) =>
    route.fulfill({
      json: {
        models: [
          { id: "test/smoke-model", label: "Smoke Model", supportsVision: true },
        ],
        default: "test/smoke-model",
      },
    })
  );

  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON() as ChatRequestBody;
    chatRequests.push(body);

    if (chatRequests.length === 1) {
      // Turn 1: assistant text + a client-executed batch_design tool call.
      await route.fulfill({
        headers: SSE_HEADERS,
        body: sseBody([
          { type: "start" },
          { type: "start-step" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: FIRST_TURN_TEXT },
          { type: "text-end", id: "t1" },
          {
            type: "tool-input-available",
            toolCallId: "call-smoke-1",
            toolName: "batch_design",
            input: { operations: BATCH_DESIGN_OPERATIONS },
          },
          { type: "finish-step" },
          { type: "finish" },
        ]),
      });
      return;
    }

    // Turn 2 (automatic continuation carrying the tool result): final text.
    await route.fulfill({
      headers: SSE_HEADERS,
      body: sseBody([
        { type: "start" },
        { type: "start-step" },
        { type: "text-start", id: "t2" },
        { type: "text-delta", id: "t2", delta: FINAL_TURN_TEXT },
        { type: "text-end", id: "t2" },
        { type: "finish-step" },
        { type: "finish" },
      ]),
    });
  });

  await page.goto("/");

  // Open the chat panel via the Design Agent toggle in the primitives toolbar.
  await page.getByTitle("Design Agent").click();
  await expect(page.getByText("Design Agent", { exact: true })).toBeVisible();

  // Send a message (Enter submits).
  const input = page.getByPlaceholder("Ask the design agent...");
  await input.fill("Create a smoke test frame");
  await input.press("Enter");

  // (a) Streamed assistant text from both turns is rendered in the chat.
  await expect(page.getByText(FIRST_TURN_TEXT)).toBeVisible();
  await expect(page.getByText(FINAL_TURN_TEXT)).toBeVisible({ timeout: 15_000 });

  // Both requests (initial + automatic continuation) have been made.
  expect(chatRequests).toHaveLength(2);

  // The first request carried the serialized canvas context.
  expect(typeof chatRequests[0].canvasContext).toBe("string");
  const canvas = JSON.parse(chatRequests[0].canvasContext as string) as {
    roots: unknown[];
    selectedIds: unknown[];
  };
  expect(Array.isArray(canvas.roots)).toBe(true);
  expect(Array.isArray(canvas.selectedIds)).toBe(true);

  // (c) The follow-up request contains the locally executed tool result.
  const assistant = chatRequests[1].messages?.find((m) => m.role === "assistant");
  expect(assistant).toBeTruthy();
  const toolPart = assistant!.parts.find((p) => p.type === "tool-batch_design");
  expect(toolPart).toBeTruthy();
  expect(toolPart!.state).toBe("output-available");
  const output = JSON.parse(String(toolPart!.output)) as {
    success: boolean;
    createdNodes: Array<{ name: string; type: string }>;
  };
  expect(output.success).toBe(true);
  expect(output.createdNodes[0]).toMatchObject({
    name: "SmokeTestFrame",
    type: "frame",
  });

  // (b) The tool really mutated the scene graph: the node exists in the
  // Zustand store (exposed on window in dev builds)...
  const storeNode = await page.evaluate(() => {
    const w = window as unknown as {
      __sceneStore?: {
        getState: () => {
          rootIds: string[];
          nodesById: Record<string, { name?: string; type?: string }>;
        };
      };
    };
    const state = w.__sceneStore?.getState();
    if (!state) return null;
    const root = state.rootIds
      .map((id) => state.nodesById[id])
      .find((n) => n?.name === "SmokeTestFrame");
    return root ? { name: root.name, type: root.type } : null;
  });
  expect(storeNode).toEqual({ name: "SmokeTestFrame", type: "frame" });

  // ...and it shows up as a layer row in the LayersPanel (layer rows carry
  // data-node-id, which keeps this distinct from any chat-message text).
  await expect(
    page.locator("[data-node-id]").filter({ hasText: "SmokeTestFrame" })
  ).toBeVisible();
});
