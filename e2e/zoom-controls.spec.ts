import { test, expect } from "@playwright/test";
import { expectEditorMounted } from "./support/editor";

// Regression test for the zoom-preset dropdown in PageControls.
//
// Root cause (fixed): the control used to be a Base UI Select whose `value`
// was the current zoom (`String(currentZoom)`). When the current zoom was a
// non-preset value (e.g. after a wheel-zoom to 223%), the options list
// injected a synthetic entry for that value. Picking a real preset applied it
// correctly, but in the same render the injected entry disappeared from the
// list — and Base UI's Select, no longer finding the previously-selected
// value among the options, fired a SECOND onValueChange with "100" (the
// list's first/default-ish entry), which `handleZoomChange` obediently
// applied, silently collapsing the zoom back to 100%.
//
// The fix replaces the value-picker Select with a DropdownMenu (an actions
// menu, not a value-picker), which structurally cannot spuriously re-fire a
// value change when its "selected" item vanishes from the list — there is no
// selected value to lose.

function getScale(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __viewportStore: { getState: () => { scale: number } };
        }
      ).__viewportStore.getState().scale,
  );
}

async function setScale(page: import("@playwright/test").Page, scale: number) {
  await page.evaluate(
    (s) =>
      (
        window as unknown as {
          __viewportStore: { getState: () => { setScale: (v: number) => void } };
        }
      ).__viewportStore.getState().setScale(s),
    scale,
  );
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/models", (route) =>
    route.fulfill({ json: { models: [], default: null } }),
  );
  await page.goto("/app");
  await expectEditorMounted(page);
  // `main.tsx` assigns the dev-only store globals from an async import(), so a
  // mounted canvas does not imply `__viewportStore` exists yet — a bare
  // page.evaluate would throw instead of retrying.
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __viewportStore?: unknown }).__viewportStore),
  );
});

test("picking a zoom preset from a non-preset zoom applies that preset, not 100%", async ({
  page,
}) => {
  // A non-integer, non-preset zoom (e.g. from wheel-zooming), matching the
  // e2e repro in the bug report (0.37 -> 1.5 -> 1, 2.2255 -> 3 -> 1, ...).
  await setScale(page, 2.2255);
  await expect.poll(() => getScale(page)).toBeCloseTo(2.2255, 4);

  await page.getByTestId("page-zoom").click();
  await page.getByTestId("page-zoom-200").click();

  await expect.poll(() => getScale(page)).toBe(2);
});

test("Fit to content from a non-preset zoom changes the zoom sensibly", async ({ page }) => {
  await setScale(page, 2.2255);
  await expect.poll(() => getScale(page)).toBeCloseTo(2.2255, 4);

  await page.getByTestId("page-zoom").click();
  await page.getByTestId("page-zoom-fit").click();

  // An empty canvas takes fitToContent's no-content branch, which pins the
  // scale to exactly 1. Asserting the exact value (rather than "finite and
  // positive") keeps this test able to fail: the bug being guarded against
  // also ended at a finite, positive scale.
  await expect.poll(() => getScale(page)).toBe(1);
});
