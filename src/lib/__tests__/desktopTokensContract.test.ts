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
const DESKTOP_EMPTY = resolve(process.cwd(), "../pen-editor-desktop/src/tabbar/empty.css");
const DESKTOP_WINDOW_THEME = resolve(process.cwd(), "../pen-editor-desktop/src/main/windowTheme.ts");
const WS_TOKENS = resolve(process.cwd(), "src/components/workspace/workspaceTokens.css");
const WS_START = resolve(process.cwd(), "src/components/workspace/workspace.css");

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

  // Icon gray: the [data-pen-icon] rule lifts near-black icons to --icon-ink-floor, which must be
  // the menu icon gray's L; the desktop's --icon is that gray in light and the old text color in dark.
  it("--icon-ink-floor is the L of --menu-muted-foreground", () => {
    const floor = blockValue(frontend, ":root", "--icon-ink-floor") ?? "missing";
    expect(norm(blockValue(frontend, ":root", "--menu-muted-foreground") ?? "missing")).toBe(norm(`oklch(${floor} 0 0)`));
  });

  it("desktop --icon is the menu icon gray (light) and the primary text color (dark)", () => {
    const pair = desktopPair(desktop, "--icon");
    expect(norm(pair.light)).toBe(norm(blockValue(frontend, ":root", "--menu-muted-foreground") ?? "missing"));
    expect(norm(pair.dark)).toBe(norm(blockValue(frontend, ".dark", "--color-text-primary") ?? "missing"));
  });

  it("desktop --icon-subtle is the same gray at alpha 0.8 (light) and --glass-text (dark)", () => {
    const pair = desktopPair(desktop, "--icon-subtle");
    const floor = blockValue(frontend, ":root", "--icon-ink-floor") ?? "missing";
    expect(norm(pair.light)).toBe(norm(`oklch(${floor} 0 0 / 0.8)`));
    expect(norm(pair.dark)).toBe(norm(desktopPair(desktop, "--glass-text").dark));
  });

  // Button tokens: the desktop's own buttons mirror the frontend ghost button.
  it("--btn-hover equals ghost hover (--secondary light, surface-hover dark)", () => {
    const pair = desktopPair(desktop, "--btn-hover");
    expect(norm(pair.light)).toBe(norm(blockValue(frontend, ":root", "--secondary") ?? "missing"));
    expect(norm(pair.dark)).toBe(norm(blockValue(frontend, ".dark", "--color-surface-hover") ?? "missing"));
  });

  // Control radii: desktop copies of the frontend's rounded-control* scale
  // (tokens.css for the tab bar / empty page / history; passwords.css keeps its own copy).
  const RADIUS_TOKENS = ["--radius-control-xs", "--radius-control-sm", "--radius-control", "--radius-control-lg", "--radius-control-xl"];
  const DESKTOP_PASSWORDS = resolve(process.cwd(), "../pen-editor-desktop/src/passwords/passwords.css");

  it.each(RADIUS_TOKENS)("%s equals the frontend @theme radius", (name) => {
    const expected = norm(blockValue(frontend, "@theme", name) ?? "missing in @theme");
    expect(norm(blockValue(desktop, ":root", name) ?? "missing in tokens.css")).toBe(expected);
  });

  it.each(RADIUS_TOKENS)("%s in passwords.css equals the frontend @theme radius", (name) => {
    const passwords = readFileSync(DESKTOP_PASSWORDS, "utf8");
    const expected = norm(blockValue(frontend, "@theme", name) ?? "missing in @theme");
    expect(norm(blockValue(passwords, ":root", name) ?? "missing in passwords.css")).toBe(expected);
  });

  it("--focus-ring equals --ring in both themes", () => {
    const pair = desktopPair(desktop, "--focus-ring");
    expect(norm(pair.light)).toBe(norm(blockValue(frontend, ":root", "--ring") ?? "missing"));
    expect(norm(pair.dark)).toBe(norm(blockValue(frontend, ".dark", "--ring") ?? "missing"));
  });

  // Web workspace copies: workspaceTokens.css (shell) and workspace.css (start page preview colours).
  const wsTokens = readFileSync(WS_TOKENS, "utf8");
  const wsStart = readFileSync(WS_START, "utf8");
  const emptyCss = desktopExists ? readFileSync(DESKTOP_EMPTY, "utf8") : "";

  /** [ws token, desktop token] */
  const SHELL_TOKENS = [
    ["--ws-tab-active", "--glass-tab-active"],
    ["--ws-tab-hover", "--glass-tab-hover"],
    ["--ws-glass-text", "--glass-text"],
    ["--ws-icon", "--icon"],
    ["--ws-icon-subtle", "--icon-subtle"],
    ["--ws-btn-hover", "--btn-hover"],
    ["--ws-control-border-strong", "--control-border-strong"],
    ["--ws-focus-ring", "--focus-ring"],
  ];

  it.each(SHELL_TOKENS)("%s equals desktop %s in both themes", (wsName, desktopName) => {
    const pair = desktopPair(desktop, desktopName);
    expect(norm(blockValue(wsTokens, ".ws-shell", wsName) ?? "missing in .ws-shell")).toBe(norm(pair.light));
    // A token with no dark override (the focus ring) resolves to its light `.ws-shell` value in dark too.
    const lightValue = blockValue(wsTokens, ".ws-shell", wsName) ?? "missing in .ws-shell";
    expect(norm(blockValue(wsTokens, ".dark .ws-shell", wsName) ?? lightValue)).toBe(norm(pair.dark));
  });

  it("--ws-glass equals GLASS_SOLID.light and the dark GLASS_BASE of windowTheme.ts", () => {
    const theme = readFileSync(DESKTOP_WINDOW_THEME, "utf8");
    const solid = /GLASS_SOLID[^=]*=\s*\{\s*light:\s*"([^"]+)"/.exec(theme);
    const base = /GLASS_BASE[^=]*=\s*\{[^}]*dark:\s*\[(\d+),\s*(\d+),\s*(\d+)\]/.exec(theme);
    expect(solid).not.toBeNull();
    expect(base).not.toBeNull();
    expect(norm(blockValue(wsTokens, ".ws-shell", "--ws-glass") ?? "missing")).toBe(norm(solid![1]));
    expect(norm(blockValue(wsTokens, ".dark .ws-shell", "--ws-glass") ?? "missing")).toBe(norm(`rgb(${base![1]}, ${base![2]}, ${base![3]})`));
  });

  const PREVIEW_TOKENS = [
    ["--ws-accent-ring", "--accent-ring"],
    ["--ws-preview-bg", "--preview-bg"],
    ["--ws-ghost", "--ghost"],
    ["--ws-ghost-surface", "--ghost-surface"],
    ["--ws-ghost-border", "--ghost-border"],
    ["--ws-dot", "--dot"],
  ];

  it.each(PREVIEW_TOKENS)("start page %s equals empty.css %s in both themes", (wsName, desktopName) => {
    const pair = desktopPair(emptyCss, desktopName);
    expect(norm(blockValue(wsStart, ".ws-start", wsName) ?? "missing in .ws-start")).toBe(norm(pair.light));
    expect(norm(blockValue(wsStart, ".dark .ws-start", wsName) ?? "missing in .dark .ws-start")).toBe(norm(pair.dark));
  });
});
