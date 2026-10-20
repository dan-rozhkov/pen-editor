import { test, expect, type Page } from "@playwright/test";
import { sampleTraceJson } from "../src/components/trace/__fixtures__/sampleTrace";

// The /trace/:id viewer against a stubbed GET /api/browse/traces/:id: no
// backend. Set TRACE_SCREENSHOT_DIR to also save a light and a dark capture.

async function openTrace(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript((value) => localStorage.setItem("ui-theme", value), theme);
  await page.route("**/api/browse/traces/sample-trace-1", (route) => route.fulfill({ json: sampleTraceJson() }));
  await page.goto("/trace/sample-trace-1");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("free trial");
}

const frame = (page: Page) => page.getByTestId("trace-frame");

test("renders the steps and switches frames", async ({ page }) => {
  await openTrace(page);
  const steps = page.getByRole("region", { name: "Steps" }).getByRole("button");
  await expect(steps).toHaveCount(8);
  await expect(frame(page)).toHaveAttribute("data-frame-id", "0");

  await steps.nth(3).click();
  await expect(frame(page)).toHaveAttribute("data-frame-id", "2");
  await page.getByRole("button", { name: "before" }).click();
  await expect(frame(page)).toHaveAttribute("data-frame-id", "1");

  await page.getByRole("button", { name: "after" }).click();
  await page.keyboard.press("ArrowRight");
  await expect(steps.nth(4)).toHaveAttribute("aria-current", "step");
  await expect(frame(page)).toHaveAttribute("data-frame-id", "3");

  await page.getByRole("button", { name: /^Frame 5,/ }).click();
  await expect(frame(page)).toHaveAttribute("data-frame-id", "4");
  await expect(page).toHaveTitle(/^Trace · Check that a visitor/);
});

test("shows the QA tab", async ({ page }) => {
  await openTrace(page);
  await page.getByRole("tab", { name: /QA/ }).click();
  await expect(page.getByText("Text “Start free trial” is visible")).toBeVisible();
});

test("shows a not-found state", async ({ page }) => {
  await page.route("**/api/browse/traces/missing", (route) => route.fulfill({ status: 404, json: { error: "not found" } }));
  await page.goto("/trace/missing");
  await expect(page.getByRole("heading", { name: "Trace not found" })).toBeVisible();
});

test("saves light and dark captures when asked", async ({ page }) => {
  const dir = process.env.TRACE_SCREENSHOT_DIR;
  test.skip(!dir, "set TRACE_SCREENSHOT_DIR to save captures");
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const theme of ["light", "dark"] as const) {
    await openTrace(page, theme);
    await page.getByRole("region", { name: "Steps" }).getByRole("button").nth(4).click();
    await expect(frame(page)).toHaveAttribute("data-frame-id", "3");
    // Let the colour and fade transitions settle before the capture.
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    await page.screenshot({ path: `${dir}/trace-${theme}.png` });
  }
});
