import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { PLUGIN_ALLOWED_TOOLS } from "../toolAllowlist";

/**
 * The backend `plugin` skill (pen-editor-backend/src/skills/plugin.md)
 * hardcodes the same `pen.tools.run` allowlist in prose, under a "####
 * Allowlist" heading, as a bulleted list of backticked tool names. This test
 * reads that section from the sibling backend checkout and asserts it's
 * exactly PLUGIN_ALLOWED_TOOLS — same pattern as toolContract.test.ts,
 * skipped when the sibling repo isn't checked out.
 */

// Vitest runs with cwd = pen-editor/, the sibling backend repo lives next to it.
const backendSkillPath = resolve(
  process.cwd(),
  "../pen-editor-backend/src/skills/plugin.md",
);
const backendExists = existsSync(backendSkillPath);

function extractAllowlistNames(markdown: string): string[] {
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) => /^####\s+Allowlist\s*$/.test(line.trim()));
  if (headingIndex === -1) {
    throw new Error(`Could not find a "#### Allowlist" heading in ${backendSkillPath}`);
  }

  const names: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line.trim())) break; // next heading ends the section
    const match = line.match(/^-\s*`([^`]+)`\s*$/);
    if (match) names.push(match[1]);
  }
  return names;
}

describe.runIf(backendExists)("plugin allowlist contract", () => {
  it("skill's Allowlist section matches PLUGIN_ALLOWED_TOOLS exactly", () => {
    const markdown = readFileSync(backendSkillPath, "utf-8");
    const skillNames = extractAllowlistNames(markdown);

    expect(skillNames.length).toBeGreaterThan(0);
    expect([...skillNames].sort()).toEqual([...PLUGIN_ALLOWED_TOOLS].sort());
  });
});

describe.runIf(!backendExists)("plugin allowlist contract (skipped)", () => {
  it.skip("pen-editor-backend not found next to pen-editor", () => {});
});
