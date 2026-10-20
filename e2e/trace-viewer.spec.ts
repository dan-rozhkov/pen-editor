import { test, expect, type Page } from "@playwright/test";
import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { sampleTraceJson } from "../src/components/trace/__fixtures__/sampleTrace";

// The /trace/:id viewer against a stubbed GET /api/browse/traces/:id: no
// backend. Set TRACE_SCREENSHOT_DIR to also save a light and a dark capture.

async function openTrace(page: Page, theme: "light" | "dark" = "light", trace: unknown = sampleTraceJson()) {
  await page.addInitScript((value) => localStorage.setItem("ui-theme", value), theme);
  await page.route("**/api/browse/traces/sample-trace-1", (route) => route.fulfill({ json: trace }));
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

test("plays the run and pauses with Space", async ({ page }) => {
  await openTrace(page);
  const steps = page.getByRole("region", { name: "Steps" }).getByRole("button");
  const playhead = page.getByRole("slider", { name: "Playhead" });
  const screen = page.getByTestId("trace-frame");
  await page.getByRole("button", { name: /^Speed:/ }).click();
  await page.getByRole("menuitemradio", { name: "4×" }).click();

  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(steps.nth(4)).toHaveAttribute("aria-current", "step"); // 4.1 s of trace time, 1 s at 4x
  await expect(screen).toHaveAttribute("data-frame-id", /^[1-9]/);

  await page.keyboard.press("Space"); // focus is on the button: it presses it
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  const stoppedAt = await playhead.getAttribute("aria-valuenow");
  await page.evaluate(() => new Promise((done) => setTimeout(done, 400)));
  await expect(playhead).toHaveAttribute("aria-valuenow", stoppedAt!);

  // Space on the page itself resumes; a manual step choice stops it again.
  await screen.click();
  await screen.press("Space");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await steps.nth(1).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(playhead).toHaveAttribute("aria-valuenow", "2150");
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

/** The sample trace with changes applied, for the state captures. */
function variant(change: (trace: BrowseTrace) => void): BrowseTrace {
  const trace = sampleTraceJson() as BrowseTrace;
  change(trace);
  return trace;
}

const passedRun = variant((t) => {
  t.steps.forEach((step) => {
    step.ok = true;
    delete step.error;
  });
  t.answer = "The trial button is visible and starts the trial.";
  t.console = [];
  t.network = [];
  t.qa = {
    outcome: "passed",
    verdict: "pass",
    reason: "The pricing page has a “Start free trial” button.",
    steps: [],
    checks: [{ source: "agent", check: { type: "text", text: "Start free trial" }, passed: true, actual: "Start free trial" }],
    judge: { verdict: "pass", reason: "The evidence shows the trial button." },
  };
});
const appRun = variant((t) => {
  t.labels = { app: "Todo Desk", mode: "qa" };
});
const setupFailed = variant((t) => {
  Object.assign(t, { steps: [], frames: [], console: [], network: [], answer: undefined, status: "error", error: "The browser could not be started: launch timed out." });
  t.qa = { outcome: "setup_failed", reason: "The browser could not be started.", steps: [], checks: [] };
});

test("saves the state captures when asked", async ({ page }) => {
  const dir = process.env.TRACE_SCREENSHOT_DIR;
  test.skip(!dir, "set TRACE_SCREENSHOT_DIR to save captures");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const shot = (name: string, target: Pick<Page, "screenshot"> = page) => target.screenshot({ path: `${dir}/${name}.png` });
  const choose = async (title: string, option: string) => {
    await page.getByRole("button", { name: new RegExp(`^${title}:`) }).click();
    await page.getByRole("menuitemradio", { name: option }).click();
  };
  const stepButtons = page.getByRole("region", { name: "Steps" }).getByRole("button");
  // Play at 4x until step 5 runs, then pause: a stable mid-playback state.
  const pauseMidway = async () => {
    await choose("Speed", "4×");
    await page.getByRole("button", { name: "Play" }).click();
    await expect(stepButtons.nth(4)).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  };

  await openTrace(page);
  await shot("01-qa-failed-overview");
  await pauseMidway();
  await shot("02-playing-midway");

  await openTrace(page, "dark");
  await stepButtons.nth(4).click();
  await shot("03-dark");

  await openTrace(page);
  await choose("Pace", "Per step");
  await page.getByRole("button", { name: /^Pace:/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "Real time" })).toBeVisible();
  await page.evaluate(() => new Promise((done) => setTimeout(done, 400))); // let the menu finish opening
  await shot("04-per-step-pace-menu-open");
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: /QA/ }).click();
  await shot("05-qa-tab");
  await page.getByRole("tab", { name: /Network/ }).click();
  await shot("06-network-tab");

  await stepButtons.nth(4).click();
  await page.getByRole("button", { name: "before" }).click();
  await shot("07-step-failed-before");

  await openTrace(page, "light", passedRun);
  await shot("08-passed-run");
  await openTrace(page, "light", appRun);
  await shot("09-app-run");
  await openTrace(page, "light", setupFailed);
  await shot("10-no-frames-setup-failed");

  await page.route("**/api/browse/traces/sample-trace-1", () => new Promise(() => {}));
  await page.goto("/trace/sample-trace-1");
  await expect(page.getByRole("status", { name: "Loading trace" })).toBeVisible();
  await shot("11-loading");
  await page.route("**/api/browse/traces/missing", (route) => route.fulfill({ status: 404, json: { error: "not found" } }));
  await page.goto("/trace/missing");
  await expect(page.getByRole("heading", { name: "Trace not found" })).toBeVisible();
  await shot("12-not-found");

  await page.setViewportSize({ width: 800, height: 900 });
  await openTrace(page);
  await shot("13-narrow-800px");
  await page.setViewportSize({ width: 1440, height: 900 });

  await openTrace(page);
  const [doc] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Open result" }).click()]);
  await doc.waitForLoadState("load");
  await expect(doc.getByText("Result", { exact: false }).first()).toBeVisible();
  await shot("14-open-result-doc", doc);
});
