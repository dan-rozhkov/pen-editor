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
    // Every run records a checkpoint journal around the setup; only applyFixture touches the page.
    if (name === "startJournal") return route.fulfill({ json: { result: { ok: true, token: "cj_e2e" }, handle: null } });
    if (name === "stopJournal") return route.fulfill({ json: { result: { ok: true }, handle: null } });
    // Every run end clears the agent's viewport emulation; it does not touch the page here.
    if (name === "clearActEmulation") return route.fulfill({ json: { result: { ok: true }, handle: null } });
    await route.fulfill({
      json: { result: { ok: false, stage: "expect", error: 'text "3 items" not found' }, handle: "h1" },
    });
  });

  await page.goto("/app");
  await openAgentsRail(page);
  await sendChatMessage(page, "Check the cart page");

  await expect(page.getByText("Setup failed")).toBeVisible({ timeout: 20_000 });
  // Setup details live under the chip's collapse.
  await page.getByRole("button", { name: /Browse Agent/ }).click();
  await expect(page.getByText(/expect — text "3 items" not found/)).toBeVisible();
  await expect(page.getByText(/The agent did not run\./)).toBeVisible();
  await expect(page.getByText("The page could not be prepared.")).toBeVisible({ timeout: 15_000 });
  const bookkeeping = new Set(["startJournal", "stopJournal", "clearActEmulation"]);
  expect(commands.filter((c) => !bookkeeping.has(c))).toEqual(["applyFixture"]);
  // The run end clears any viewport emulation, also after a failed setup.
  await expect.poll(() => commands.includes("clearActEmulation")).toBe(true);
  // The journal started for the run is stopped again (in the background), and no checkpoint is taken after a failed setup.
  await expect.poll(() => commands.includes("stopJournal")).toBe(commands.includes("startJournal"));
  expect(commands).not.toContain("captureCheckpoint");
  // Only the two main-chat turns: the nested browse session never started.
  expect(chatRequests).toHaveLength(2);
});
