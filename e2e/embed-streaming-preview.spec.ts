import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { expectEditorMounted } from "./support/editor";
import {
  installChatStreamStub,
  push,
  closeStream,
  replyWithText,
  waitForRequestCount,
  openChatAndSend,
} from "./support/chatStream";

// Real-browser coverage for the streaming embed preview ("magic design"):
// while a batch_design screen's htmlContent is still streaming, its partial
// markup is already rendered live on the canvas; when the statement
// completes, the real embed node replaces the preview in place.
//
// `RECORD_DEMO=1` records a video of the run (used for the feature demo);
// the assertions are the same either way.

// One template, two screens: the second is the same layout re-skinned (light
// palette, warm accent) with its own copy, so the fixtures cannot drift.
const TEMPLATE = readFileSync(new URL("./fixtures/streaming-screen.html", import.meta.url), "utf8");

function reskin(html: string, replacements: Array<[string, string]>): string {
  return replacements.reduce((acc, [from, to]) => acc.split(from).join(to), html);
}

const SCREENS = [
  { name: "Home", x: 0, html: TEMPLATE },
  {
    name: "Session",
    x: 450,
    html: reskin(TEMPLATE, [
      ["background:#0f1115;color:#f3f1ec", "background:#f4efe6;color:#1d1a16"],
      ["#1a1d24", "#fffaf2"],
      ["#b9ff66", "#ff7a45"],
      ["rgba(30,33,41,.92)", "#1d1a16"],
      ["Good morning", "Box breathing"],
      ["Maya Chen", "Session"],
      ["Morning flow for deep focus", "Inhale for four, hold for four"],
      ["Your week", "Rounds"],
      ["Continue", "Next up"],
    ]),
  },
];

const OPERATIONS = SCREENS.map(
  (s, i) =>
    `s${i}=I(document, {type: "embed", name: "${s.name}", x: ${s.x}, y: 0, width: 390, height: 844, htmlContent: ${JSON.stringify(s.html)}})\n`,
).join("");

function countEmbeds(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      Object.values(
        (window as unknown as { __sceneStore: { getState: () => { nodesById: Record<string, { type?: string }> } } })
          .__sceneStore.getState().nodesById,
      ).filter((n) => n.type === "embed").length,
  );
}

if (process.env.RECORD_DEMO) {
  test.use({ video: { mode: "on", size: { width: 1440, height: 900 } }, viewport: { width: 1440, height: 900 } });
}

test("batch_design screen html streams onto the canvas before the node exists", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await installChatStreamStub(page);
  await page.goto("/app");
  await expectEditorMounted(page);

  await openChatAndSend(page, "design a breathing app, two screens");
  await waitForRequestCount(page, 1);
  await page.evaluate(() => {
    (window as unknown as {
      __viewportStore: { getState: () => { setViewportState: (s: { scale: number; x: number; y: number }) => void } };
    }).__viewportStore.getState().setViewportState({ scale: 0.82, x: 420, y: 60 });
  });

  await push(page, 0, { type: "start" });
  await push(page, 0, { type: "start-step" });
  await push(page, 0, { type: "tool-input-start", toolCallId: "screens-1", toolName: "batch_design" });

  const argsJson = JSON.stringify({ operations: OPERATIONS });
  // Stop just short of the first screen's closing `})\n` so its statement is
  // still incomplete — exactly the window this feature exists to fill.
  const firstEnd = argsJson.indexOf("})\\n");
  const midFirst = Math.floor(firstEnd * 0.85);
  const chunkSize = Number(process.env.RECORD_DEMO ? 14 : 400);
  const delayMs = Number(process.env.RECORD_DEMO ? 16 : 0);

  const streamRange = (from: number, to: number) =>
    page.evaluate(
      async ({ text, chunkSize, delayMs }) => {
        const c = (window as unknown as { __chatControllers: Array<{ push: (c: unknown) => void }> }).__chatControllers[0];
        for (let i = 0; i < text.length; i += chunkSize) {
          c.push({ type: "tool-input-delta", toolCallId: "screens-1", inputTextDelta: text.slice(i, i + chunkSize) });
          if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        }
      },
      { text: argsJson.slice(from, to), chunkSize, delayMs },
    );

  await streamRange(0, midFirst);

  // Partial HTML is live on the canvas; no embed node exists yet.
  const preview = page.locator("[data-streaming-embed-preview]").first();
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate(
        (el) => el.querySelector("[data-streaming-embed-shadow]")?.shadowRoot?.textContent ?? "",
      ),
    )
    .toContain("Maya Chen");
  const embedsBefore = await countEmbeds(page);
  expect(embedsBefore).toBe(0);
  // Stills for the demo/debugging, attached to the test output.
  await page.screenshot({ path: testInfo.outputPath("streaming-embed-mid.png") });

  await streamRange(midFirst, argsJson.length);
  await push(page, 0, { type: "tool-input-available", toolCallId: "screens-1", toolName: "batch_design", input: { operations: OPERATIONS } });
  await push(page, 0, { type: "finish-step" });
  await push(page, 0, { type: "finish" });
  await closeStream(page, 0);

  await waitForRequestCount(page, 2);
  await replyWithText(page, 1, "Two screens are on the canvas.");

  // The real embeds took over; every preview is gone.
  await expect(page.locator("[data-streaming-embed-preview]")).toHaveCount(0);
  const embedsAfter = await countEmbeds(page);
  expect(embedsAfter).toBe(2);
  await expect(page.getByText("Two screens are on the canvas.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("streaming-embed-final.png") });
});
