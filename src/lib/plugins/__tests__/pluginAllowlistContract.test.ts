import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { PLUGIN_ALLOWED_TOOLS } from "../toolAllowlist";
import { PLUGIN_UI_KIT_STYLES } from "../uiKitStyles";

/**
 * The backend `plugin` skill (pen-editor-backend/src/skills/plugin.md)
 * hardcodes the same `pen.tools.run` allowlist in prose, under a "####
 * Allowlist" heading, as a bulleted list of backticked tool names. This test
 * reads that section from the sibling backend checkout and asserts it's
 * exactly PLUGIN_ALLOWED_TOOLS — same pattern as toolContract.test.ts,
 * skipped when the sibling repo isn't checked out.
 *
 * It also guards the skill's "## UI-kit classes" section the same way: that
 * section lists every `.pen-*` class a plugin can use, as a bulleted list of
 * backticked class names, and must stay in sync with the classes actually
 * defined in `PLUGIN_UI_KIT_STYLES` (`uiKitStyles.ts`) — otherwise the
 * catalog could document a class the stylesheet dropped, or the stylesheet
 * could grow one the catalog never mentions.
 */

// Vitest runs with cwd = pen-editor/, the sibling backend repo lives next to it.
const backendSkillPath = resolve(
  process.cwd(),
  "../pen-editor-backend/src/skills/plugin.md",
);
const backendExists = existsSync(backendSkillPath);

// In the cross-repo CI job the sibling checkout is mandatory — a missing
// backend must fail the job, not silently skip the contract. Mirrors
// toolContract.test.ts's guard so this test can't self-skip there either.
if (process.env.CONTRACT_REQUIRE_BACKEND && !backendExists) {
  throw new Error(
    `CONTRACT_REQUIRE_BACKEND is set but ${backendSkillPath} does not exist`,
  );
}

function extractBulletedHeadingNames(markdown: string, headingPattern: RegExp): string[] {
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (headingIndex === -1) {
    throw new Error(`Could not find a heading matching ${headingPattern} in ${backendSkillPath}`);
  }

  const names: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line.trim())) break; // next heading ends the section
    const match = line.match(/^-\s*`([^`]+)`/);
    if (match) names.push(match[1]);
  }
  return names;
}

function extractAllowlistNames(markdown: string): string[] {
  return extractBulletedHeadingNames(markdown, /^####\s+Allowlist\s*$/);
}

/** Pulls the base `.pen-*` class name out of each catalog bullet — the
 * heading lists selectors only (e.g. `.pen-button`), never pseudo-classes or
 * compound selectors, so a plain match is enough. */
function extractCatalogClassNames(markdown: string): string[] {
  return extractBulletedHeadingNames(markdown, /^##\s+UI-kit classes\s*$/);
}

/** Every distinct `.pen-*` class name actually defined in the stylesheet,
 * deduped — compound/stateful selectors like
 * `.pen-button.pen-button-primary:hover:not(:disabled)` still surface their
 * two base class names via this scan. */
function extractStylesheetClassNames(css: string): string[] {
  const names = new Set(
    [...css.matchAll(/\.pen-[a-z0-9-]+/g)].map((m) => m[0]),
  );
  return [...names];
}

describe.runIf(backendExists)("plugin allowlist contract", () => {
  it("skill's Allowlist section matches PLUGIN_ALLOWED_TOOLS exactly", () => {
    const markdown = readFileSync(backendSkillPath, "utf-8");
    const skillNames = extractAllowlistNames(markdown);

    expect(skillNames.length).toBeGreaterThan(0);
    expect([...skillNames].sort()).toEqual([...PLUGIN_ALLOWED_TOOLS].sort());
  });

  it("skill's UI-kit classes section matches PLUGIN_UI_KIT_STYLES exactly", () => {
    const markdown = readFileSync(backendSkillPath, "utf-8");
    const catalogNames = extractCatalogClassNames(markdown);
    const stylesheetNames = extractStylesheetClassNames(PLUGIN_UI_KIT_STYLES);

    expect(catalogNames.length).toBeGreaterThan(0);
    expect([...catalogNames].sort()).toEqual([...stylesheetNames].sort());
  });
});

describe.runIf(!backendExists)("plugin allowlist contract (skipped)", () => {
  it.skip("pen-editor-backend not found next to pen-editor", () => {});
});
