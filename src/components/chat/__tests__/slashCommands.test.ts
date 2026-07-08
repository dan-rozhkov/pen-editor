import { describe, it, expect } from "vitest";
import { SLASH_COMMANDS, type SlashCommand } from "../slashCommands";

describe("SLASH_COMMANDS", () => {
  it("exposes a non-empty list of commands", () => {
    expect(Array.isArray(SLASH_COMMANDS)).toBe(true);
    expect(SLASH_COMMANDS.length).toBeGreaterThan(0);
  });

  it("every command has a name, description and category", () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(typeof cmd.name).toBe("string");
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(typeof cmd.description).toBe("string");
      expect(cmd.description.length).toBeGreaterThan(0);
      expect(typeof cmd.category).toBe("string");
      expect(cmd.category.length).toBeGreaterThan(0);
    }
  });

  it("command names are unique", () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("uses only the documented categories", () => {
    const allowed = new Set([
      "Diagnostic",
      "Quality",
      "Intensity",
      "Adaptation",
      "Enhancement",
      "System",
    ]);
    for (const cmd of SLASH_COMMANDS) {
      expect(allowed.has(cmd.category)).toBe(true);
    }
  });

  it("includes well-known commands like audit and extract", () => {
    const byName = (name: string): SlashCommand | undefined =>
      SLASH_COMMANDS.find((c) => c.name === name);
    expect(byName("audit")?.category).toBe("Diagnostic");
    expect(byName("extract")?.category).toBe("System");
  });

  it("includes first-draft for generating a whole screen from one sentence", () => {
    const firstDraft = SLASH_COMMANDS.find((c) => c.name === "first-draft");
    expect(firstDraft).toBeDefined();
    expect(firstDraft?.category).toBe("System");
    expect(firstDraft?.description.length).toBeGreaterThan(0);
  });

  it("does not contain leading slashes or whitespace in names", () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.name).not.toMatch(/^\//);
      expect(cmd.name).not.toMatch(/\s/);
    }
  });
});
