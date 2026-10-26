import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cross-repo contract: the Electron shell's local pages (tabbar, empty page)
 * copy a few frontend colour tokens into pen-editor-desktop
 * src/tabbar/tokens.css as `light-dark(light, dark)` pairs. If a frontend
 * token changes and the copy does not, the tab bar island stops matching the
 * editor — silently. Skipped when the sibling checkout is absent, unless
 * CONTRACT_REQUIRE_DESKTOP=1 (then it fails).
 */
const DESKTOP_TOKENS = resolve(process.cwd(), "../pen-editor-desktop/src/tabbar/tokens.css");
const FRONTEND_CSS = resolve(process.cwd(), "src/index.css");

/** desktop variable -> frontend variable it mirrors. */
const MIRRORED: Record<string, string> = {
  "--island-bg": "--color-surface-panel",
  "--border": "--color-border-default",
  "--text": "--color-text-muted",
  "--text-active": "--color-text-primary",
  "--agent-cursor": "--color-accent-primary",
};

/** Popup tokens: same name on both sides; frontend values live in `:root` / `.dark`. */
const MENU_TOKENS = ["--menu", "--menu-border", "--menu-muted-foreground", "--menu-highlight", "--menu-separator"];

const norm = (value: string) => value.replace(/\s+/g, "").toLowerCase();

/** Value of `--name:` in the first block opened by exactly `selector {` that defines it. */
function blockValue(css: string, selector: string, name: string): string | undefined {
  const declaration = new RegExp(`(?<![\\w-])${name}\\s*:\\s*([^;]+);`);
  for (let at = css.indexOf(`${selector} {`); at >= 0; at = css.indexOf(`${selector} {`, at + 1)) {
    const match = declaration.exec(css.slice(at, css.indexOf("\n}", at)));
    if (match) return match[1].trim();
  }
  return undefined;
}

function desktopPair(css: string, name: string): { light: string; dark: string } {
  const raw = blockValue(css, ":root", name);
  if (raw === undefined) throw new Error(`${name} missing from desktop tokens.css`);
  const pair = /^light-dark\((.+)\)$/.exec(raw);
  if (!pair) return { light: raw, dark: raw }; // theme-independent
  // split on the top-level comma (rgba(...) contains commas inside parens)
  let depth = 0;
  for (let i = 0; i < pair[1].length; i++) {
    const ch = pair[1][i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) return { light: pair[1].slice(0, i).trim(), dark: pair[1].slice(i + 1).trim() };
  }
  throw new Error(`cannot split light-dark() for ${name}: ${raw}`);
}

const desktopExists = existsSync(DESKTOP_TOKENS);

// Same rule as desktopMenuContract: the cross-repo CI job must fail, not skip.
if (process.env.CONTRACT_REQUIRE_DESKTOP && !desktopExists) {
  throw new Error(`CONTRACT_REQUIRE_DESKTOP is set but ${DESKTOP_TOKENS} does not exist`);
}

describe.runIf(desktopExists)("desktop token contract", () => {
  const desktop = desktopExists ? readFileSync(DESKTOP_TOKENS, "utf8") : "";
  const frontend = readFileSync(FRONTEND_CSS, "utf8");

  it.each(Object.entries(MIRRORED))("%s equals %s in both themes", (desktopName, frontendName) => {
    const pair = desktopPair(desktop, desktopName);
    expect(norm(pair.light)).toBe(norm(blockValue(frontend, "@theme", frontendName) ?? "missing in @theme"));
    expect(norm(pair.dark)).toBe(norm(blockValue(frontend, ".dark", frontendName) ?? "missing in .dark"));
  });

  it.each(MENU_TOKENS)("%s equals the frontend popup token in both themes", (name) => {
    const pair = desktopPair(desktop, name);
    expect(norm(pair.light)).toBe(norm(blockValue(frontend, ":root", name) ?? "missing in :root"));
    expect(norm(pair.dark)).toBe(norm(blockValue(frontend, ".dark", name) ?? "missing in .dark"));
  });

  // Button tokens: the desktop's own buttons mirror the frontend ghost button.
  it("--btn-hover equals ghost hover (--secondary light, surface-hover dark)", () => {
    const pair = desktopPair(desktop, "--btn-hover");
    expect(norm(pair.light)).toBe(norm(blockValue(frontend, ":root", "--secondary") ?? "missing"));
    expect(norm(pair.dark)).toBe(norm(blockValue(frontend, ".dark", "--color-surface-hover") ?? "missing"));
  });

  it("--btn-radius equals rounded-md (--radius minus 2px)", () => {
    const radius = blockValue(frontend, ":root", "--radius") ?? "missing";
    const pair = desktopPair(desktop, "--btn-radius");
    const expected = norm(`calc(${radius} - 2px)`);
    expect(norm(pair.light)).toBe(expected);
    expect(norm(pair.dark)).toBe(expected);
  });

  it("--focus-ring equals --ring in both themes", () => {
    const pair = desktopPair(desktop, "--focus-ring");
    expect(norm(pair.light)).toBe(norm(blockValue(frontend, ":root", "--ring") ?? "missing"));
    expect(norm(pair.dark)).toBe(norm(blockValue(frontend, ".dark", "--ring") ?? "missing"));
  });
});
