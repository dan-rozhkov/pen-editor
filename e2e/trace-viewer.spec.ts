import { crc32, deflateSync } from "node:zlib";
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
  await expect(page.getByRole("group", { name: "Frame view" })).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(steps.nth(4)).toHaveAttribute("aria-current", "step");
  await expect(frame(page)).toHaveAttribute("data-frame-id", "3");

  await page.getByRole("button", { name: /^Frame 5,/ }).click();
  await expect(frame(page)).toHaveAttribute("data-frame-id", "4");
  await expect(page).toHaveTitle(/^Check that a visitor/);
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

test("hides and shows the details panel, and remembers it", async ({ page }) => {
  await openTrace(page);
  const toggle = page.getByRole("button", { name: "Details panel" });
  await toggle.click();
  await expect(page.getByRole("tab", { name: /Console/ })).toBeHidden();
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(page.getByRole("tab", { name: /Console/ })).toBeVisible();
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

/** A solid-colour PNG data URL of the given size (the trace parser accepts only png/jpeg/webp). */
function solidPng(width: number, height: number): string {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0xe6)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
}
// Recorded size deliberately wrong (landscape): the box must follow the image's own proportions.
const narrowScreenshot = variant((t) => {
  const src = solidPng(600, 1200);
  t.frames.forEach((f) => Object.assign(f, { src, width: 640, height: 400 }));
});

async function openNarrow(page: Page) {
  await openTrace(page, "light", narrowScreenshot);
  await expect(frame(page)).toHaveAttribute("data-frame-id", "0");
  await expect.poll(() => frame(page).evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(600);
}

test("sizes the frame box to a narrow screenshot's own proportions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNarrow(page);
  await expect
    .poll(async () => {
      const box = await frame(page).boundingBox();
      return box ? box.width / box.height : 0;
    })
    .toBeCloseTo(0.5, 1);
  const box = (await frame(page).boundingBox())!;
  expect(Math.abs(box.width / box.height - 0.5)).toBeLessThan(0.02);
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
  await shot("07-step-failed");

  await page.getByRole("button", { name: "Details panel" }).click();
  await shot("15-details-hidden");
  await page.getByRole("button", { name: "Details panel" }).click();
  await page.getByRole("button", { name: /^Run details/ }).click();
  await expect(page.getByRole("dialog").getByText("Duration")).toBeVisible();
  await expect(page.locator("[data-slot=popover-content][data-open]")).toBeVisible();
  await shot("16-run-details-popover");
  await page.keyboard.press("Escape");

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

  await openNarrow(page);
  await shot("17-narrow-screenshot");
});
