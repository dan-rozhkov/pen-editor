// Captures the real editor (/app, dark theme) with a deterministic 3-screen habit-tracker document.
// Reproduce (from the pen-editor root):
//   1. npx vite --port 5198 --strictPort        (any free port; pass it as baseUrl)
//   2. node scripts/landing-hero/capture-editor.mjs http://localhost:5198 /tmp/signale editor-raw.png
//   3. node scripts/landing-hero/encode.mjs /tmp/signale/editor-raw.png
//      -> public/landing/sideform-editor-dark.webp (2880x1800) and -1440.webp (1440x900)
//   Tune the zoom-out with env ZOOM_WHEEL / ZOOM_X / ZOOM_Y if the layout of the panels changes.
// Usage: node scripts/landing-hero/capture-editor.mjs [baseUrl] [outDir] [outName]
//   env: BASE_URL, OUT_DIR, OUT_NAME (default editor-dark-raw.png)
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const baseUrl = process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:5198";
const outDir = process.argv[3] ?? process.env.OUT_DIR ?? "/tmp/landing-cap";
const outName = process.argv[4] ?? process.env.OUT_NAME ?? "editor-dark-raw.png";
mkdirSync(outDir, { recursive: true });

const screens = [
  ["Welcome", "01-welcome.html"],
  ["Pick your habits", "02-habits.html"],
  ["Today", "03-today.html"],
];
const nodes = screens.map(([name, file], i) => ({
  id: `screen-${i + 1}`,
  type: "embed",
  name,
  x: i * (390 + 80),
  y: 0,
  width: 390,
  height: 844,
  htmlContent: readFileSync(join(here, "sample-screens", file), "utf8"),
}));
const doc = {
  version: "1.1",
  pages: [{ id: "page-1", name: "Page 1", nodes }],
  variables: [],
  activeTheme: "dark",
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.addInitScript(() => localStorage.setItem("ui-theme", "dark"));
await page.route("**/api/**", (route) => {
  const url = route.request().url();
  if (url.includes("/api/models")) return route.fulfill({ json: { models: [], default: null } });
  return route.fulfill({ status: 404, json: {} });
});
await page.goto(`${baseUrl}/app`);
await page.waitForSelector("[data-canvas]", { timeout: 60000 });

// Real File > Open path: the menu item creates an <input type=file> and clicks it.
await page.getByRole("button", { name: "File", exact: true }).click();
const chooserPromise = page.waitForEvent("filechooser");
await page.getByRole("menuitem", { name: "Open", exact: true }).click();
const chooser = await chooserPromise;
await chooser.setFiles({ name: "habit-tracker.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)) });

await page.getByText("Pick your habits").first().waitFor({ timeout: 15000 });
await page.waitForTimeout(1500);
// Hide the dev-only FPS badge (vite dev server only; production has none).
await page.addStyleTag({ content: '[title="FPS (dev only)"]{display:none!important}' });
await page.keyboard.press("ControlOrMeta+0"); // zoom to fit
await page.waitForTimeout(500);
// Fit ignores the side panels, so zoom out a bit around the visible canvas centre
// (ZOOM_WHEEL env tunes it) to get all three screens between the panels.
await page.mouse.move(Number(process.env.ZOOM_X ?? 745), Number(process.env.ZOOM_Y ?? 470));
await page.keyboard.down("Control");
await page.mouse.wheel(0, Number(process.env.ZOOM_WHEEL ?? 150));
await page.keyboard.up("Control");
await page.waitForTimeout(500);
await page.getByText("Pick your habits").first().click(); // select middle screen via layers panel

await page.evaluate(async () => {
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});
await page.mouse.move(1, 1);
await page.waitForTimeout(2500);
const out = join(outDir, outName);
await page.screenshot({ path: out, fullPage: true });
console.log("wrote", out);
await browser.close();
