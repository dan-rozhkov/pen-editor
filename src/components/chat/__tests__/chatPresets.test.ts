import { describe, it, expect } from "vitest";
import { CHAT_PRESETS } from "../chatPresets";

const VALID_MODES = new Set(["edits", "prototype", "research"]);

describe("CHAT_PRESETS", () => {
  it("exposes a non-empty list of presets", () => {
    expect(Array.isArray(CHAT_PRESETS)).toBe(true);
    expect(CHAT_PRESETS.length).toBeGreaterThan(0);
  });

  it("every preset has id, label, message, mode and model", () => {
    for (const preset of CHAT_PRESETS) {
      expect(typeof preset.id).toBe("string");
      expect(preset.id.length).toBeGreaterThan(0);
      expect(typeof preset.label).toBe("string");
      expect(preset.label.length).toBeGreaterThan(0);
      expect(typeof preset.message).toBe("string");
      expect(preset.message.length).toBeGreaterThan(0);
      expect(typeof preset.model).toBe("string");
      expect(preset.model.length).toBeGreaterThan(0);
    }
  });

  it("preset ids are unique", () => {
    const ids = CHAT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each preset mode is a valid AgentMode", () => {
    for (const preset of CHAT_PRESETS) {
      expect(VALID_MODES.has(preset.mode)).toBe(true);
    }
  });

  it("includes a research-mode preset", () => {
    expect(CHAT_PRESETS.some((p) => p.mode === "research")).toBe(true);
  });
});
