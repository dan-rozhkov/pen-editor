import { test, expect } from "@playwright/test";

// Smoke test for View (read-only) and Present (fullscreen) modes. No backend
// needed. We inject a top-level frame straight into the Zustand scene graph
// (exposed on window in dev builds), then exercise the modes via the floating
// ModeToolbar and the editor-mode store.

const SEED_FRAME = `(() => {
  const w = window;
  const f = {
    id: "viewmode-frame",
    type: "frame",
    name: "ViewModeFrame",
    x: 0, y: 0, width: 400, height: 300,
    fill: "#ffffff",
  };
  w.__sceneStore.setState({
    nodesById: { [f.id]: f },
    parentById: { [f.id]: null },
    childrenById: { [f.id]: [] },
    rootIds: [f.id],
  });
})()`;

test("View and Present modes toggle via the toolbar and store", async ({ page }) => {
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { models: [], default: null } })
  );

  await page.goto("/");

  // Seed a frame so Present has something to show.
  await page.evaluate(SEED_FRAME);

  // The floating ModeToolbar is visible in edit mode.
  await expect(page.getByTestId("mode-view-toggle")).toBeVisible();
  await expect(page.getByTestId("mode-present")).toBeEnabled();

  // Enter View mode from the toolbar.
  await page.getByTestId("mode-view-toggle").click();
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __editorModeStore: { getState: () => { mode: string } };
          }
        ).__editorModeStore.getState().mode
    )
  ).toBe("view");

  // Back to edit.
  await page.getByTestId("mode-view-toggle").click();
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __editorModeStore: { getState: () => { mode: string } };
          }
        ).__editorModeStore.getState().mode
    )
  ).toBe("edit");

  // Enter Present from the toolbar — chrome is replaced by the slide overlay.
  await page.getByTestId("mode-present").click();
  await expect(page.getByTestId("present-counter")).toBeVisible();
  await expect(page.getByTestId("present-counter")).toHaveText("1 / 1");
  // Editor toolbar is gone in present mode.
  await expect(page.getByTestId("mode-view-toggle")).toHaveCount(0);

  // Exit present via the overlay's exit button.
  await page.getByTestId("present-exit").click();
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __editorModeStore: { getState: () => { mode: string } };
          }
        ).__editorModeStore.getState().mode
    )
  ).toBe("edit");
  await expect(page.getByTestId("mode-view-toggle")).toBeVisible();
});
