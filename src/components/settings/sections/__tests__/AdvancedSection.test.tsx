import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generationRevealFlag, isGenerationRevealEnabled } from "@/lib/embedGenerationReveal";
import { rasterCacheFlag } from "@/lib/rasterCachePref";
import { isStreamingMutationsEnabled, streamingMutationsFlag } from "@/lib/streamingTools/types";

import { AdvancedSection } from "../AdvancedSection";

const KEYS = ["pen.generationReveal", "pen.streamingMutations", "pen.rasterCache"];

beforeEach(() => KEYS.forEach((k) => localStorage.removeItem(k)));
afterEach(() => {
  cleanup();
  KEYS.forEach((k) => localStorage.removeItem(k));
});

describe("kill-switch flags", () => {
  it("default to on and use the legacy 'off' value", () => {
    for (const [flag, key] of [
      [generationRevealFlag, "pen.generationReveal"],
      [streamingMutationsFlag, "pen.streamingMutations"],
      [rasterCacheFlag, "pen.rasterCache"],
    ] as const) {
      expect(flag.get()).toBe(true);
      flag.set(false);
      expect(localStorage.getItem(key)).toBe("off");
      expect(flag.get()).toBe(false);
      flag.set(true);
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it("readers see values written the old way", () => {
    localStorage.setItem("pen.generationReveal", "off");
    localStorage.setItem("pen.streamingMutations", "off");
    expect(isGenerationRevealEnabled()).toBe(false);
    expect(isStreamingMutationsEnabled()).toBe(false);
  });
});

describe("AdvancedSection", () => {
  it("toggles each switch and the stored value", () => {
    render(<AdvancedSection />);
    const cases = [
      ["Show screens while they generate", "pen.generationReveal"],
      ["Apply agent edits as they stream", "pen.streamingMutations"],
      ["Cache idle frames as images", "pen.rasterCache"],
    ];
    for (const [name, key] of cases) {
      const sw = screen.getByRole("switch", { name });
      expect(sw.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(sw);
      expect(localStorage.getItem(key)).toBe("off");
      expect(screen.getByRole("switch", { name }).getAttribute("aria-checked")).toBe("false");
      fireEvent.click(screen.getByRole("switch", { name }));
      expect(localStorage.getItem(key)).toBeNull();
    }
  });
});
