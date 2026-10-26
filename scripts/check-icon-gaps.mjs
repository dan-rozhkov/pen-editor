// Manual check: find icons whose strokes sit too close together.
//
// Why: icons are drawn on a 16-grid with a 1.25px stroke at a fixed SCREEN
// width (`vector-effect: non-scaling-stroke`, see index.css). At 12-14px the
// grid shrinks but the stroke does not, so the gaps between lines close up.
// Rule (as in Lucide etc.): the clear gap between two strokes must be at
// least the stroke width.
//
// How: every icon is server-rendered to SVG markup (Vite SSR from the repo's
// own config), then rendered in headless chromium at 12/14/16 px at 8x device
// scale. Ink is thresholded, then a morphological closing (Euclidean distance
// transforms, radius = half the minimum gap) is applied; background pixels the
// closing fills are "narrow gap" pixels. The result is their area in screen px².
// Acute corners and tight curves also register a little area, so the threshold
// is not zero: the 39° base corners of the Flip triangles score up to ~3.7 px²
// at 14px with no real gap problem, hence 4.
//
// Usage: node scripts/check-icon-gaps.mjs [--size=14] [--threshold=4] [--json] [--all]
// Allowlist: scripts/icon-gaps-allowlist.json  { "IconName": "reason" }
// Exit 1 when a non-allowlisted icon exceeds the threshold at --size.
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, loadConfigFromFile } from "vite";
import { chromium } from "playwright";

const STROKE = 1.25; // px; minimum clear gap = stroke width
const DEFAULT_SIZE = 14;
const DEFAULT_THRESHOLD = 4; // px² of narrow-gap area
const REPORT_SIZES = [12, 14, 16];
const SCALE = 8; // device scale factor

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const SIZE = Number(args.size ?? DEFAULT_SIZE);
const THRESHOLD = Number(args.threshold ?? DEFAULT_THRESHOLD);
const sizes = [...new Set([...REPORT_SIZES, SIZE])];
const allowlist = JSON.parse(
  fs.readFileSync(new URL("./icon-gaps-allowlist.json", import.meta.url), "utf8"),
);

async function renderIcons() {
  // Reuse the repo's own config, minus its react aliases: they point at a
  // directory, which makes Vite inline react's CJS build into the SSR graph
  // ("module is not defined") and split it from the renderer's React instance.
  const loaded = await loadConfigFromFile({ command: "serve", mode: "development", isSsrBuild: true }, undefined, undefined, "error");
  const config = loaded?.config ?? {};
  const alias = config.resolve?.alias ?? {};
  const keep = Array.isArray(alias)
    ? alias.filter((a) => !/^react(-dom)?$/.test(String(a.find)))
    : Object.fromEntries(Object.entries(alias).filter(([k]) => !/^react(-dom)?$/.test(k)));
  const server = await createServer({
    ...config,
    configFile: false,
    resolve: { ...config.resolve, alias: keep },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    logLevel: "error",
  });
  try {
    const mod = await server.ssrLoadModule("/src/components/icons/index.ts");
    const out = {};
    for (const [name, Icon] of Object.entries(mod)) {
      if (/^[A-Z]\w*Icon$/.test(name)) {
        out[name] = renderToStaticMarkup(createElement(Icon, { size: 16 }));
      }
    }
    return out;
  } finally {
    await server.close();
  }
}

async function measure(icons) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      deviceScaleFactor: SCALE,
      viewport: { width: 100, height: 100 },
    });
    await page.setContent(
      `<style>[data-pen-icon] *{vector-effect:non-scaling-stroke}body{margin:0;background:#fff;color:#000}</style><div id=h></div>`,
    );
    const shots = {};
    for (const [name, svg] of Object.entries(icons)) {
      shots[name] = {};
      for (const s of sizes) {
        await page.evaluate(
          ([svg, s]) => {
            const h = document.getElementById("h");
            h.innerHTML = `<div style="width:${s}px;height:${s}px;display:flex">${svg}</div>`;
            const el = h.querySelector("svg");
            el.setAttribute("width", s);
            el.setAttribute("height", s);
          },
          [svg, s],
        );
        const buf = await page.screenshot({ clip: { x: 0, y: 0, width: s, height: s } });
        shots[name][s] = buf.toString("base64");
      }
    }
    return await page.evaluate(
      async ({ shots, K, STROKE }) => {
        // Squared Euclidean distance transform (Felzenszwalb) to the nearest "on" pixel.
        const edt1 = (f, n) => {
          const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
          let k = 0;
          v[0] = 0; z[0] = -1e20; z[1] = 1e20;
          for (let q = 1; q < n; q++) {
            let s;
            for (;;) {
              const r = v[k];
              s = (f[q] + q * q - (f[r] + r * r)) / (2 * q - 2 * r);
              if (s <= z[k]) { k--; continue; }
              break;
            }
            k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
          }
          k = 0;
          for (let q = 0; q < n; q++) {
            while (z[k + 1] < q) k++;
            d[q] = (q - v[k]) ** 2 + f[v[k]];
          }
          return d;
        };
        const edt = (on, W, H) => {
          const g = new Float64Array(W * H);
          for (let x = 0; x < W; x++) {
            const f = new Float64Array(H);
            for (let y = 0; y < H; y++) f[y] = on[y * W + x] ? 0 : 1e20;
            const d = edt1(f, H);
            for (let y = 0; y < H; y++) g[y * W + x] = d[y];
          }
          for (let y = 0; y < H; y++) {
            const d = edt1(g.slice(y * W, y * W + W), W);
            for (let x = 0; x < W; x++) g[y * W + x] = d[x];
          }
          return g;
        };
        const r2 = ((STROKE / 2) * K) ** 2;
        const R = {};
        for (const [name, bySize] of Object.entries(shots)) {
          R[name] = {};
          for (const [s, b64] of Object.entries(bySize)) {
            const img = new Image();
            img.src = "data:image/png;base64," + b64;
            await img.decode();
            // Pad with white by more than the closing radius: without it, ink
            // near the clip edge dilates to the edge and the erosion cannot
            // pull it back, so a glyph at the safe-zone limit would score a
            // false gap along the border.
            const pad = Math.ceil((STROKE / 2) * K) + 2;
            const W = img.width + 2 * pad, H = img.height + 2 * pad, N = W * H;
            const c = new OffscreenCanvas(W, H), x = c.getContext("2d");
            x.fillStyle = "#fff";
            x.fillRect(0, 0, W, H);
            x.drawImage(img, pad, pad);
            const px = x.getImageData(0, 0, W, H).data;
            const ink = new Uint8Array(N);
            for (let i = 0; i < N; i++) ink[i] = px[i * 4] < 128 ? 1 : 0;
            const dIn = edt(ink, W, H);
            const notDil = new Uint8Array(N);
            for (let i = 0; i < N; i++) notDil[i] = dIn[i] <= r2 ? 0 : 1;
            const dOut = edt(notDil, W, H);
            let gap = 0;
            for (let i = 0; i < N; i++) if (!ink[i] && dOut[i] > r2) gap++;
            R[name][s] = +(gap / K / K).toFixed(2);
          }
        }
        return R;
      },
      { shots, K: SCALE, STROKE },
    );
  } finally {
    await browser.close();
  }
}

const t0 = Date.now();
const icons = await renderIcons();
const names = Object.keys(icons).sort();
const gaps = await measure(icons);
const seconds = +((Date.now() - t0) / 1000).toFixed(1);

const rows = names.map((name) => ({
  name,
  area: gaps[name][SIZE],
  at12: gaps[name][12],
  at14: gaps[name][14],
  at16: gaps[name][16],
  failing: gaps[name][SIZE] > THRESHOLD,
  allowlisted: name in allowlist,
}));
const failures = rows.filter((r) => r.failing && !r.allowlisted).sort((a, b) => b.area - a.area);
const allowedFailing = rows.filter((r) => r.failing && r.allowlisted).sort((a, b) => b.area - a.area);
// The allowlist is graded at the default size: at another --size an entry
// that still fails at 14px may pass, so only missing icons count as stale.
const stale = Object.keys(allowlist).filter((n) => {
  const r = rows.find((x) => x.name === n);
  return !r || (SIZE === DEFAULT_SIZE && !r.failing);
});

if (args.json) {
  console.log(
    JSON.stringify(
      { size: SIZE, threshold: THRESHOLD, stroke: STROKE, seconds, measured: rows.length, failures, allowedFailing, stale, all: args.all ? rows : undefined },
      null,
      2,
    ),
  );
} else {
  const fmt = (r) =>
    `${r.name.padEnd(36)} ${String(r.area.toFixed(2)).padStart(7)}  (12px: ${r.at12.toFixed(2)}, 14px: ${r.at14.toFixed(2)}, 16px: ${r.at16.toFixed(2)})`;
  console.log(`Icon gap check: ${rows.length} icons, size ${SIZE}px, threshold ${THRESHOLD} px², min gap ${STROKE}px, ${seconds}s`);
  if (args.all) {
    console.log("\nAll icons:");
    for (const r of [...rows].sort((a, b) => b.area - a.area)) console.log("  " + fmt(r));
  }
  if (failures.length) {
    console.log(`\nFAIL: ${failures.length} icon(s) over threshold (worst first):`);
    for (const r of failures) console.log("  " + fmt(r));
  }
  if (allowedFailing.length) {
    console.log(`\nAllowlisted (would fail):`);
    for (const r of allowedFailing) console.log("  " + fmt(r) + `  - ${allowlist[r.name]}`);
  }
  for (const n of stale) {
    console.warn(`WARNING: stale allowlist entry "${n}" (${rows.some((r) => r.name === n) ? "no longer fails" : "icon no longer exists"}).`);
  }
  if (!failures.length) console.log("\nOK: no icon over threshold.");
}
process.exit(failures.length ? 1 : 0);
