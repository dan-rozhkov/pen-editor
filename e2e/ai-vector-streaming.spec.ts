import { test, expect } from "@playwright/test";
import { expectEditorMounted } from "./support/editor";
import {
  installChatStreamStub,
  push,
  closeStream,
  replyWithText,
  waitForRequestCount,
  openChatAndSend,
} from "./support/chatStream";

// Task 8: real-browser coverage for the streaming AI vector drawing feature
// (Tasks 3-7). Unlike chat-smoke.spec.ts (which fulfills /api/chat with one
// static SSE body), this spec needs to assert preview state BEFORE the tool's
// final input lands, which requires genuine chunk-by-chunk delivery over
// real time. page.route's fulfill() only accepts a complete Buffer/string
// body, so it can't do that. Instead we install a `window.fetch` override via
// page.addInitScript that, for /api/chat requests, returns a Response backed
// by a real ReadableStream whose controller the test pushes into directly
// (window.__chatControllers[i].push/close) — each push is a separate
// page.evaluate round-trip, so the SSE reader inside the app genuinely awaits
// real chunks over real time, exactly like the equivalent unit test
// (src/hooks/__tests__/useDesignChat.test.ts's controlledSseResponse()).

const VECTOR_NAME = "Leaf";
const FINAL_COMMANDS =
  'M(100,100)\nL(200,100)\nL(150,200)\nCLOSE()\nFILL("#65a765")\nEND()';

interface ChatRequestBody {
  messages?: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
}

test.describe("streaming AI vector drawing (native draw_vector)", () => {
  test("previews before commit, commits one path, auto-continues with success output, and undoes in one step", async ({
    page,
  }) => {
    await installChatStreamStub(page);
    await page.goto("/app");
    await expectEditorMounted(page);

    await openChatAndSend(page, "draw a leaf");
    await waitForRequestCount(page, 1);

    // --- Stream the draw_vector tool call in real, separately-delivered
    // chunks: tool-input-start, then two deltas that complete exactly the
    // M and L commands.
    await push(page, 0, { type: "start" });
    await push(page, 0, { type: "start-step" });
    await push(page, 0, {
      type: "tool-input-start",
      toolCallId: "vector-1",
      toolName: "draw_vector",
    });
    await push(page, 0, {
      type: "tool-input-delta",
      toolCallId: "vector-1",
      inputTextDelta: '{"name":"Leaf","commands":"M(100,100)\\n',
    });
    await push(page, 0, {
      type: "tool-input-delta",
      toolCallId: "vector-1",
      inputTextDelta: "L(200,100)\\n",
    });

    // Preview must exist and have >= 2 anchors BEFORE the final chunk, and
    // the scene must not have a committed path node yet.
    await page.waitForFunction(() => {
      const store = (
        window as unknown as {
          __aiVectorPreviewStore: {
            getState: () => { drafts: Record<string, { points: unknown[] }> };
          };
        }
      ).__aiVectorPreviewStore;
      const drafts = Object.values(store.getState().drafts);
      return drafts.length === 1 && drafts[0].points.length >= 2;
    });
    const hasPathBeforeFinal = await page.evaluate(() =>
      Object.values(
        (window as unknown as { __sceneStore: { getState: () => { nodesById: Record<string, { type?: string }> } } })
          .__sceneStore.getState().nodesById
      ).some((n) => n.type === "path")
    );
    expect(hasPathBeforeFinal).toBe(false);

    // The Pixi overlay must actually be rendering it — the container labelled
    // "ai-vector-previews" has a real, non-degenerate child with drawn
    // geometry, not just store state.
    const previewLayer = await page.evaluate(() => {
      const refs = (
        window as unknown as {
          __canvasRefStore: {
            getState: () => {
              pixiRefs: {
                overlayContainer: {
                  children: Array<{ label?: string; children: unknown[]; getBounds: () => { width: number; height: number } }>;
                };
              } | null;
            };
          };
        }
      ).__canvasRefStore.getState().pixiRefs;
      const root = refs?.overlayContainer.children.find((c) => c.label === "ai-vector-previews");
      if (!root) return null;
      const bounds = root.getBounds();
      return { childCount: root.children.length, width: bounds.width, height: bounds.height };
    });
    expect(previewLayer).not.toBeNull();
    expect(previewLayer!.childCount).toBeGreaterThan(0);
    expect(previewLayer!.width).toBeGreaterThan(0);
    expect(previewLayer!.height).toBeGreaterThan(0);

    // --- Release the rest of the stream, completing the tool call.
    await push(page, 0, {
      type: "tool-input-delta",
      toolCallId: "vector-1",
      inputTextDelta: 'L(150,200)\\nCLOSE()\\nFILL(\\"#65a765\\")\\n',
    });
    await push(page, 0, {
      type: "tool-input-delta",
      toolCallId: "vector-1",
      inputTextDelta: 'END()"}',
    });
    await push(page, 0, {
      type: "tool-input-available",
      toolCallId: "vector-1",
      toolName: "draw_vector",
      input: { name: VECTOR_NAME, commands: FINAL_COMMANDS },
    });
    await push(page, 0, { type: "finish-step" });
    await push(page, 0, { type: "finish" });
    await closeStream(page, 0);

    // Exactly one automatic continuation request carrying the tool result.
    await waitForRequestCount(page, 2);
    await replyWithText(page, 1, "Drawn.");

    await expect(page.getByText("Drawn.")).toBeVisible({ timeout: 15_000 });

    // Preview store settles empty once the real node is committed.
    await page.waitForFunction(
      () =>
        Object.keys(
          (
            window as unknown as {
              __aiVectorPreviewStore: { getState: () => { drafts: Record<string, unknown> } };
            }
          ).__aiVectorPreviewStore.getState().drafts
        ).length === 0
    );

    // Exactly one committed path node, matching the streamed geometry/fill.
    const pathNode = await page.evaluate(() =>
      Object.values(
        (window as unknown as { __sceneStore: { getState: () => { nodesById: Record<string, { type?: string; name?: string; fill?: string }> } } })
          .__sceneStore.getState().nodesById
      ).find((n) => n.type === "path")
    );
    expect(pathNode).toMatchObject({ name: VECTOR_NAME, type: "path", fill: "#65a765" });
    const pathCount = await page.evaluate(() =>
      Object.values(
        (window as unknown as { __sceneStore: { getState: () => { nodesById: Record<string, { type?: string }> } } })
          .__sceneStore.getState().nodesById
      ).filter((n) => n.type === "path").length
    );
    expect(pathCount).toBe(1);

    // Layers panel shows it.
    await page.getByTestId("rail-pages").click();
    await expect(
      page.locator("[data-node-id]").filter({ hasText: VECTOR_NAME })
    ).toBeVisible();

    // The follow-up request carried the tool-draw_vector part with
    // output-available and a success:true output.
    const requests = await page.evaluate(
      () => (window as unknown as { __chatRequests: ChatRequestBody[] }).__chatRequests
    );
    const assistant = requests[1].messages?.find((m) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    const toolPart = assistant!.parts.find((p) => p.type === "tool-draw_vector");
    expect(toolPart).toBeTruthy();
    expect(toolPart!.state).toBe("output-available");
    const output = JSON.parse(String(toolPart!.output)) as { success: boolean };
    expect(output.success).toBe(true);

    // One undo removes the whole committed node (add + auto-select collapsed
    // into a single history batch).
    await page.evaluate(() => {
      const commands = (
        window as unknown as { __getCommands: () => Array<{ id: string; run: () => void }> }
      ).__getCommands();
      commands.find((c) => c.id === "edit-undo")!.run();
    });
    await page.waitForFunction(() =>
      Object.values(
        (window as unknown as { __sceneStore: { getState: () => { nodesById: Record<string, { type?: string }> } } })
          .__sceneStore.getState().nodesById
      ).every((n) => n.type !== "path")
    );
  });

  test("Stop mid-stream leaves no preview, no new path, and unchanged history", async ({ page }) => {
    await installChatStreamStub(page);
    await page.goto("/app");
    await expectEditorMounted(page);

    const historyPastLengthBefore = await page.evaluate(
      () =>
        (window as unknown as { __historyStore: { getState: () => { past: unknown[] } } })
          .__historyStore.getState().past.length
    );

    await openChatAndSend(page, "draw a leaf, then stop me");
    await waitForRequestCount(page, 1);

    await push(page, 0, { type: "start" });
    await push(page, 0, { type: "start-step" });
    await push(page, 0, {
      type: "tool-input-start",
      toolCallId: "vector-stop-1",
      toolName: "draw_vector",
    });
    await push(page, 0, {
      type: "tool-input-delta",
      toolCallId: "vector-stop-1",
      inputTextDelta: '{"name":"Leaf","commands":"M(100,100)\\n',
    });
    await push(page, 0, {
      type: "tool-input-delta",
      toolCallId: "vector-stop-1",
      inputTextDelta: "L(200,100)\\n",
    });

    // Preview exists mid-stream, same as the success scenario.
    await page.waitForFunction(() => {
      const store = (
        window as unknown as {
          __aiVectorPreviewStore: {
            getState: () => { drafts: Record<string, { points: unknown[] }> };
          };
        }
      ).__aiVectorPreviewStore;
      const drafts = Object.values(store.getState().drafts);
      return drafts.length === 1 && drafts[0].points.length >= 2;
    });

    // Stop the turn. ChatPanel and ChatInput both render a Stop button (one
    // for the compact layout); either click triggers the same handler, so
    // `.first()` is sufficient and unambiguous in effect.
    await page.getByRole("button", { name: "Stop" }).first().click();

    // The in-flight fetch's AbortSignal actually fired — the stream really
    // was canceled, not just abandoned client-side.
    await page.waitForFunction(() =>
      (window as unknown as { __chatAborted: boolean[] }).__chatAborted[0] === true
    );

    // No orphan preview for the stopped session.
    await page.waitForFunction(
      () =>
        Object.keys(
          (
            window as unknown as {
              __aiVectorPreviewStore: { getState: () => { drafts: Record<string, unknown> } };
            }
          ).__aiVectorPreviewStore.getState().drafts
        ).length === 0
    );

    // No partial/committed scene mutation.
    const hasPath = await page.evaluate(() =>
      Object.values(
        (window as unknown as { __sceneStore: { getState: () => { nodesById: Record<string, { type?: string }> } } })
          .__sceneStore.getState().nodesById
      ).some((n) => n.type === "path")
    );
    expect(hasPath).toBe(false);

    // History is untouched — Stop never ran the commit path.
    const historyPastLengthAfter = await page.evaluate(
      () =>
        (window as unknown as { __historyStore: { getState: () => { past: unknown[] } } })
          .__historyStore.getState().past.length
    );
    expect(historyPastLengthAfter).toBe(historyPastLengthBefore);
  });
});
