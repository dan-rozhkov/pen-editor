import { test, expect } from "@playwright/test";
import { EDITOR_MOUNT_TIMEOUT } from "./support/editor";

// Smoke test for the "/c/:shareId" read-only viewer. No backend needed:
// GET /api/canvas/:id is stubbed with a minimal one-page PenDocument (the
// exact shape src/utils/fileUtils.ts's serializeDocument/deserializeDocument
// round-trip), so the whole viewer -> editor(view mode) -> fork(edit mode,
// /app) loop is covered without a real share ever being created.

function penDocument() {
  return JSON.stringify({
    version: "1.1",
    pages: [
      {
        id: "page-1",
        name: "Page 1",
        nodes: [
          {
            id: "frame-1",
            type: "frame",
            name: "SharedFrame",
            x: 0,
            y: 0,
            width: 400,
            height: 300,
            fill: "#ffffff",
            children: [],
          },
        ],
      },
    ],
    variables: [],
    textStyles: [],
    fillStyles: [],
    effectStyles: [],
    activeTheme: "light",
    componentArtifacts: {},
  });
}

function getMode(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __editorModeStore: { getState: () => { mode: string } };
        }
      ).__editorModeStore.getState().mode,
  );
}

test("shared canvas viewer: view mode, read-only bar, and Make a copy", async ({ page }) => {
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { models: [], default: null } }),
  );
  await page.route("**/api/canvas/*", (route) =>
    route.fulfill({
      json: {
        id: "testid",
        title: "A Shared Canvas",
        document: penDocument(),
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    }),
  );

  await page.goto("/c/testid");

  // The editor mounts (its own lazy chunk, same as /app) in read-only view
  // mode, and the shared-view bar is visible above the canvas.
  await expect(page.locator("[data-canvas]")).toBeVisible({ timeout: EDITOR_MOUNT_TIMEOUT });
  await expect.poll(() => getMode(page)).toBe("view");
  await expect(page.getByTestId("shared-canvas-bar")).toBeVisible();
  await expect(page.getByTestId("shared-canvas-bar")).toContainText("A Shared Canvas");
  await expect(page.getByTestId("shared-canvas-bar")).toContainText("View only");

  // "Make a copy" leaves view mode and lands on /app, editable.
  await page.getByRole("button", { name: "Make a copy" }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect.poll(() => getMode(page)).toBe("edit");
});
