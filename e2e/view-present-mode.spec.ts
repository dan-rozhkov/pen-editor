import { test, expect } from "@playwright/test";

// Smoke test for View (read-only) and Present (fullscreen) modes. No backend
// needed. View mode is enabled only via the ?view URL param. We inject a
// top-level frame straight into the Zustand scene graph (exposed on window in
// dev builds) so Present has something to show, then drive it from the Play
// button + present overlay.

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

test("?view URL param enables read-only view mode", async ({ page }) => {
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { models: [], default: null } })
  );

  await page.goto("/?view=1");
  // The app enters view mode on load from the URL param.
  await expect.poll(() => getMode(page)).toBe("view");
  // There is no in-app view toggle anymore.
  await expect(page.getByTestId("mode-view-toggle")).toHaveCount(0);
});

test("Present mode via the Play button and overlay navigation", async ({ page }) => {
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { models: [], default: null } })
  );

  await page.goto("/");
  await page.evaluate(SEED_FRAME);

  // The blue Play button in the page controls enters Present mode.
  await expect(page.getByTestId("page-present")).toBeEnabled();
  await page.getByTestId("page-present").click();

  await expect(page.getByTestId("present-counter")).toBeVisible();
  await expect(page.getByTestId("present-counter")).toHaveText("1 / 1");

  // Exit present via the overlay's exit button.
  await page.getByTestId("present-exit").click();
  await expect.poll(() => getMode(page)).toBe("edit");
});
