import { test, expect } from "@playwright/test";
import { SSE_HEADERS, sseBody } from "./support/sse";

// Regression test for a mobile-only bug: the left sidebar (which hosts the
// Agents chat) used to fully unmount on mobile when the panel closed
// (`if (isMobile && !isPanelOpen) return null`). Since the chat's message
// state lives only in a mounted `useChat` instance, closing and reopening the
// panel wiped the transcript. The fix keeps the sidebar mounted on mobile and
// just hides it with `display: none`.

const USER_MESSAGE = "Hello from the mobile chat history test";
const ASSISTANT_REPLY = "Hi! I received your message.";

test.use({ viewport: { width: 390, height: 844 } });

test("mobile: closing and reopening the Agents panel keeps chat history", async ({
  page,
}) => {
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
    await route.fulfill({
      headers: SSE_HEADERS,
      body: sseBody([
        { type: "start" },
        { type: "start-step" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: ASSISTANT_REPLY },
        { type: "text-end", id: "t1" },
        { type: "finish-step" },
        { type: "finish" },
      ]),
    });
  });

  await page.goto("/app");

  // Open the Agents section from the left rail.
  await page.getByTestId("rail-agents").click();
  await expect(page.getByText("Design Agent", { exact: true })).toBeVisible();

  // Send a message.
  const input = page.getByPlaceholder("Ask the design agent...");
  await input.fill(USER_MESSAGE);
  await input.press("Enter");

  // Scope message assertions to the active chat session's transcript — the
  // sent text is also mirrored into the chat's title in the header, so an
  // unscoped getByText matches both and trips Playwright's strict mode.
  const activeSession = page.locator(
    '[data-testid^="chat-session-"]:not(.hidden)'
  );

  await expect(activeSession.getByText(USER_MESSAGE)).toBeVisible();
  await expect(activeSession.getByText(ASSISTANT_REPLY)).toBeVisible({
    timeout: 15_000,
  });

  // Close the panel: tap the already-active rail button again (mobile-only
  // toggle behavior in LeftRail's handleSectionClick).
  await page.getByTestId("rail-agents").click();
  await expect(page.getByText("Design Agent", { exact: true })).toBeHidden();

  // Reopen it.
  await page.getByTestId("rail-agents").click();
  await expect(page.getByText("Design Agent", { exact: true })).toBeVisible();

  // The previously sent message and reply must still be there.
  await expect(activeSession.getByText(USER_MESSAGE)).toBeVisible();
  await expect(activeSession.getByText(ASSISTANT_REPLY)).toBeVisible();
});
