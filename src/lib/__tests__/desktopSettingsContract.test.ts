import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SETTINGS_SECTIONS } from "@/lib/openSettings";

/**
 * Cross-repo contract: the Electron shell validates `?section=<id>` against its
 * own copy of the Settings section ids (pen-editor-desktop src/main/config.ts).
 * A section added here but not there would be silently dropped by the shell.
 * Skipped when the sibling checkout is absent, unless CONTRACT_REQUIRE_DESKTOP=1
 * (CONTRACT_REQUIRE_BACKEND=1 does not require it).
 */
const DESKTOP_CONFIG = resolve(process.cwd(), "../pen-editor-desktop/src/main/config.ts");
const desktopExists = existsSync(DESKTOP_CONFIG);

if (process.env.CONTRACT_REQUIRE_DESKTOP && !desktopExists) {
  throw new Error(`CONTRACT_REQUIRE_DESKTOP is set but ${DESKTOP_CONFIG} does not exist`);
}

function desktopSections(): string[] {
  const source = readFileSync(DESKTOP_CONFIG, "utf8");
  const match = /export const SETTINGS_SECTIONS\s*=\s*\[([^\]]*)\]/.exec(source);
  if (!match) throw new Error("SETTINGS_SECTIONS not found in pen-editor-desktop src/main/config.ts");
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

describe.runIf(desktopExists)("desktop settings sections contract", () => {
  it("SETTINGS_SECTIONS matches the desktop shell's list", () => {
    expect(desktopSections()).toEqual([...SETTINGS_SECTIONS]);
  });
});
