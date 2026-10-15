import { test, expect } from "@playwright/test";
import { stubModels, stubChatTurns, openAgentsRail, sendChatMessage } from "./support/api";

// browse_agent with a `setup` page fixture. The web build uses the cloud
// bridge, so applyFixture goes to POST /api/browser/cmd/applyFixture, stubbed
// here to fail at stage "expect". The card must show the failure and that the
// nested agent never ran (no nested /api/chat request beyond the two turns).

test("browse_agent setup that fails shows Setup failed and 'The agent did not run.'", async ({ page }) => {
  await stubModels(page);
  const chatRequests = await stubChatTurns(page, [
    [
      { type: "start" },
      { type: "start-step" },
      {
        type: "tool-input-available",
        toolCallId: "call-fixture-1",
        toolName: "browse_agent",
        input: {
          goal: "Check the cart",
          url: "https://shop.test/cart",
          setup: { expect: { text: "3 items" }, network: [{ url: "https://api.shop.test/*", status: 500 }] },
        },
      },
      { type: "finish-step" },
      { type: "finish" },
    ],
    [
      { type: "start" },
      { type: "start-step" },
      { type: "text-start", id: "t2" },
      { type: "text-delta", id: "t2", delta: "The page could not be prepared." },
      { type: "text-end", id: "t2" },
      { type: "finish-step" },
      { type: "finish" },
    ],
  ]);
  const commands: string[] = [];
  await page.route("**/api/browser/cmd/*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    commands.push(name);
    await route.fulfill({
      json: { result: { ok: false, stage: "expect", error: 'text "3 items" not found' }, handle: "h1" },
    });
  });

  await page.goto("/app");
  await openAgentsRail(page);
  await sendChatMessage(page, "Check the cart page");

  await expect(page.getByText("Setup failed")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Stage: expect — text "3 items" not found')).toBeVisible();
  await expect(page.getByText("The agent did not run.")).toBeVisible();
  await expect(page.getByText("The page could not be prepared.")).toBeVisible({ timeout: 15_000 });
  expect(commands).toEqual(["applyFixture"]);
  // Only the two main-chat turns: the nested browse session never started.
  expect(chatRequests).toHaveLength(2);
});
