// Captures Sideform Desktop (dark) three times for the landing hero slider: a canvas tab, a browser tab
// and a document tab, in one window with the agent panel. Real app, real pages; only the content is seeded.
//
// Reproduce (from the pen-editor root):
//   1. npx vite --port 5300 --strictPort
//   2. (cd ../pen-editor-desktop && npm run build)
//   3. node scripts/landing-hero/capture-desktop.mjs <desktopDir> <outDir>
//      -> <outDir>/desktop-canvas.png, desktop-browser.png, desktop-doc.png (window only, 2x)
//   4. node scripts/landing-hero/encode.mjs <png> <name>   (once per png)
// env: EDITOR_URL (default http://localhost:5300/app), BROWSER_URL (the page shown in the browser tab).
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(process.argv[2] ?? join(here, "../../../pen-editor-desktop"));
const outDir = resolve(process.argv[3] ?? "/tmp/landing-desktop");
const EDITOR_URL = process.env.EDITOR_URL ?? "http://localhost:5300/app";
const ORIGIN = new URL(EDITOR_URL).origin;
const BROWSER_URL = process.env.BROWSER_URL ?? "https://linear.app/";
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- seeded content (written before launch)

const home = mkdtempSync(join(tmpdir(), "sideform-landing-shot-"));
const userData = join(home, "userData");
const now = Date.now();

const CANVAS_ID = "cv_landing";
const screens = [
  ["Hero", "01-hero.html"],
  ["Three apps", "02-apps.html"],
  ["Get Sideform", "03-get.html"],
];
const doc = {
  version: "1.1",
  pages: [
    {
      id: "page-1",
      name: "Page 1",
      pageBackground: "#2a2a2a",
      nodes: screens.map(([name, file], i) => ({
        id: `screen-${i + 1}`,
        type: "embed",
        name,
        // A column: the agent layout leaves a narrow canvas, so the sections stack.
        x: 0,
        y: i * (760 + 120),
        width: 1200,
        height: 760,
        htmlContent: readFileSync(join(here, "sample-landing", file), "utf8"),
      })),
    },
  ],
  variables: [],
  activeTheme: "dark",
};
const canvasDir = join(userData, "canvases-dev");
mkdirSync(canvasDir, { recursive: true });
writeFileSync(join(canvasDir, `${CANVAS_ID}.pen.json`), JSON.stringify({ id: CANVAS_ID, rev: 1, document: JSON.stringify(doc) }));
writeFileSync(join(canvasDir, `${CANVAS_ID}.meta.json`), JSON.stringify({ id: CANVAS_ID, title: "Landing", updatedAt: now, rev: 1 }));

const DOC_ID = "doc_landing";
const markdown = readFileSync(join(here, "sample-landing", "brief.md"), "utf8");
const docDir = join(userData, "documents-dev");
mkdirSync(docDir, { recursive: true });
writeFileSync(join(docDir, `${DOC_ID}.json`), JSON.stringify({ id: DOC_ID, title: "Landing redesign", markdown, updatedAt: now, rev: 1 }));

// A finished agent turn: references in the browser, three sections on the canvas, the brief in a doc.
const CHAT_ID = "landing-redesign";
const tool = (name, id, input, output) => ({ type: `tool-${name}`, toolCallId: id, state: "output-available", input, output });
const messages = [
  {
    id: "m1",
    role: "user",
    parts: [{ type: "text", text: "Redesign our landing: dark, one flowing gradient, the real app in the hero. Use linear.app and the Signale template as references." }],
  },
  {
    id: "m2",
    role: "assistant",
    parts: [
      { type: "text", text: "I'll look at both references first." },
      tool("browse_open", "t1", { url: "https://linear.app/" }, JSON.stringify({ url: "https://linear.app/", title: "Linear", loaded: true })),
      tool("browse_screenshot", "t2", {}, JSON.stringify({ ok: true })),
      tool("browse_open", "t3", { url: "https://try-signall.framer.website/" }, JSON.stringify({ url: "https://try-signall.framer.website/", title: "Signale", loaded: true })),
      { type: "text", text: "Both use a black page, one large headline and a lot of empty space. Signale adds a single gradient ribbon, so I'll keep that as the only decoration." },
      tool("batch_design", "t4", { operations: 'hero=I(document, {type: "embed", name: "Hero"})' }, "Created 3 screens: Hero, Three apps, Get Sideform."),
      tool("doc_create", "t5", { title: "Landing redesign" }, JSON.stringify({ docId: DOC_ID, title: "Landing redesign" })),
      { type: "text", text: "Done. The three sections are on the canvas and the brief is in Landing redesign. Next I'd check contrast and focus states." },
    ],
  },
];
const chatDir = join(userData, "chats-dev");
mkdirSync(chatDir, { recursive: true });
writeFileSync(join(chatDir, `${CHAT_ID}.chat.json`), JSON.stringify({ id: CHAT_ID, rev: 1, messages }));
writeFileSync(
  join(chatDir, `${CHAT_ID}.meta.json`),
  JSON.stringify({ id: CHAT_ID, title: "Landing redesign", titleIsAuto: false, model: "", updatedAt: now, rev: 1, messageCount: messages.length }),
);

// ---------------------------------------------------------------- launch

const app = await electron.launch({
  executablePath: join(desktopDir, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
  // 2x on any screen, so the landing gets a sharp 2880x1800 capture of a 1440x900 window.
  args: ["--force-device-scale-factor=2", desktopDir],
  cwd: desktopDir,
  env: {
    ...process.env,
    PEN_DESKTOP_URL: EDITOR_URL,
    PEN_DESKTOP_USER_DATA_DIR: userData,
    PEN_DESKTOP_NO_ANIMATIONS: "1",
    HOME: home,
  },
});
const find = async (pred) => app.windows().find(pred) ?? (await app.waitForEvent("window", { predicate: pred, timeout: 90_000 }));
const isPanel = (p) => p.url().startsWith(`${ORIGIN}/agent`);
const isCanvas = (p) => p.url().startsWith(`${ORIGIN}/app`);
const isDoc = (p) => p.url().startsWith(`${ORIGIN}/doc`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mainWindow = `(() => {
  const w = BaseWindow.getAllWindows().find((x) =>
    x.contentView.children.some((c) => c.webContents?.getURL().endsWith("/tabbar/tabbar.html")));
  if (!w) throw new Error("main window not found");
  return w;
})()`;
// The tab bar and the empty start must exist before any main-process code runs (see the desktop e2e launch helper).
const [tabbar] = await Promise.all(["/tabbar/tabbar.html", "/tabbar/empty.html", "/omnibox/omnibox.html"].map((s) => find((p) => p.url().endsWith(s))));
const panel = await find(isPanel);
await app.evaluate(({ BaseWindow }, src) => {
  const w = eval(src);
  w.setContentSize(Number(process.env.WIN_W ?? 1440), Number(process.env.WIN_H ?? 900));
  w.center();
}, mainWindow);

const waitPanel = () =>
  panel.getByPlaceholder("Ask Sideform Agent…").or(panel.getByTestId("chat-list-new")).first().waitFor({ state: "visible", timeout: 90_000 });
await waitPanel();
await panel.evaluate(() => localStorage.setItem("ui-theme", "dark"));
await panel.reload();
await waitPanel();

// A composite of every visible view's capturePage() at its bounds. screencapture -l would give the
// screen's scale (1x on a non-Retina display); capturePage gives the forced 2x. The glass behind the
// tab bar is transparent in a capture, so it is filled with the dark glass tint.
async function shot(name) {
  await sleep(1500);
  const png = await app.evaluate(async ({ BaseWindow, BrowserWindow }, src) => {
    const win = eval(src);
    const cb = win.getContentBounds();
    const parts = [];
    for (const child of win.contentView.children) {
      const wc = child.webContents;
      if (!wc || !child.getVisible?.()) continue;
      const b = child.getBounds();
      const img = await wc.capturePage();
      parts.push({ x: b.x, y: b.y, w: b.width, h: b.height, png: img.toPNG().toString("base64") });
    }
    const w = new BrowserWindow({ show: false, width: 100, height: 100 });
    await w.loadURL("about:blank");
    const data = { width: cb.width, height: cb.height, parts };
    const b64 = await w.webContents.executeJavaScript(`(async () => {
      const d = ${JSON.stringify(data)};
      const c = document.createElement("canvas");
      c.width = d.width * 2;
      c.height = d.height * 2;
      const g = c.getContext("2d");
      g.fillStyle = "#1c1c1e";
      g.fillRect(0, 0, c.width, c.height);
      // The native traffic lights are not in any view: draw them inactive, where macOS puts them.
      g.fillStyle = "#4a4a4c";
      for (const cx of [20, 40, 60]) {
        g.beginPath();
        g.arc(cx * 2, 19 * 2, 6 * 2, 0, Math.PI * 2);
        g.fill();
      }
      for (const p of d.parts) {
        const im = new Image();
        im.src = "data:image/png;base64," + p.png;
        await im.decode();
        g.drawImage(im, p.x * 2, p.y * 2, p.w * 2, p.h * 2);
      }
      return c.toDataURL("image/png").split(",")[1];
    })()`);
    w.destroy();
    return b64;
  }, mainWindow);
  const file = join(outDir, name);
  writeFileSync(file, Buffer.from(png, "base64"));
  console.log("wrote", file);
}

// ---------------------------------------------------------------- 1. canvas
await panel.evaluate(() => window.penAgentPanel.canvas.openTab({ activate: true }));
let canvas = await find(isCanvas);
await canvas.evaluate((id) => {
  location.href = `/app?canvas=${id}&chat=off`;
}, CANVAS_ID);
await canvas.waitForURL(new RegExp(`canvas=${CANVAS_ID}`), { timeout: 60_000 });
await canvas.waitForFunction(() => Object.keys(window.__sceneStore?.getState().nodesById ?? {}).length >= 3, undefined, { timeout: 90_000 });
await sleep(2500);
await canvas.addStyleTag({ content: '[title="FPS (dev only)"]{display:none!important}' });
// Name the file, select the first section (its properties show on the right), then frame the column.
await canvas.evaluate(async () => {
  const { useDocumentStore } = await import("/src/store/documentStore.ts");
  useDocumentStore.getState().setFileName("Landing");
  window.__selectionStore.getState().select("screen-1");
});
await sleep(500);
await canvas.evaluate(() => {
  const el = document.querySelector("[data-canvas]");
  const r = el.getBoundingClientRect();
  // The canvas element runs under the side panels; find the part where it is on top.
  const y = r.top + r.height / 2;
  let left = null;
  let right = null;
  for (let x = Math.ceil(r.left); x < r.right; x += 2) {
    if (el.contains(document.elementFromPoint(x, y))) {
      left ??= x;
      right = x;
    }
  }
  const visibleW = right - left;
  const contentW = 1200;
  const contentH = 3 * 760 + 2 * 120;
  const scale = Math.min((visibleW - 64) / contentW, (r.height - 96) / contentH);
  window.__viewportStore.getState().setViewportState({ scale, x: left - r.left + (visibleW - contentW * scale) / 2, y: 56 });
});
await canvas.mouse.move(1, 1);

// ---------------------------------------------------------------- 2. browser (opened now, shot later)
await panel.evaluate((url) => window.penAgentPanel.browser.open({ url }), BROWSER_URL);
await sleep(6000);
// A capture shows the page's classic (non-overlay) scrollbar as a white bar; hide it for the shot only.
await app.evaluate(async ({ webContents }, url) => {
  const host = new URL(url).host;
  for (const wc of webContents.getAllWebContents()) {
    if (wc.getURL().includes(host)) await wc.insertCSS("::-webkit-scrollbar { display: none !important; }");
  }
}, BROWSER_URL);

// ---------------------------------------------------------------- 3. document
await panel.evaluate((id) => window.penAgentPanel.docs.open(id), DOC_ID);
const docPage = await find(isDoc);
await docPage.getByText("Landing redesign").first().waitFor({ timeout: 60_000 });
await docPage.mouse.move(1, 1);

// ---------------------------------------------------------------- the chat: open the seeded turn
await panel.getByTestId("back-to-chat-list").click().catch(() => undefined);
await panel.getByText("Landing redesign", { exact: true }).first().click();
await panel.getByText("Next I'd check contrast", { exact: false }).waitFor({ timeout: 30_000 });
await panel.mouse.move(1, 1);

// Scrollbars read as stray bars in a still image: hide them in every page for the shots.
for (const page of [panel, canvas, docPage]) await page.addStyleTag({ content: "::-webkit-scrollbar { display: none !important; } * { scrollbar-width: none !important; }" });

// ---------------------------------------------------------------- shots: all three tabs stay open, one active per frame
const tabs = tabbar.locator(".tab");
for (const [index, name] of [[0, "canvas"], [1, "browser"], [2, "doc"]]) {
  await tabs.nth(index).click();
  await tabbar.mouse.move(1, 200);
  await shot(`desktop-${name}.png`);
}

await app.close();
