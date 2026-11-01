// Usage: node scripts/landing-hero/encode.mjs [rawPng]   (requires `cwebp` on PATH, e.g. brew install webp)
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const raw = process.argv[2] ?? "/tmp/signale/editor-raw.png";
const out = resolve(root, "public/landing");
mkdirSync(out, { recursive: true });
const run = (q, w, h, name) =>
  execFileSync("cwebp", ["-q", String(q), "-m", "6", "-resize", String(w), String(h), raw, "-o", resolve(out, name)], { stdio: "inherit" });
run(86, 2880, 1800, "sideform-editor-dark.webp");
run(84, 1440, 900, "sideform-editor-dark-1440.webp");
