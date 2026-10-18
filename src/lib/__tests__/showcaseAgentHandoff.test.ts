import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearShowcaseAgentPrompt,
  peekShowcaseAgentPrompt,
  storeShowcaseAgentPrompt,
} from "@/lib/showcaseAgentHandoff";

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("showcase agent prompt handoff", () => {
  it("stores a trimmed prompt, peeks without removing and clears on request", () => {
    expect(storeShowcaseAgentPrompt("  make a travel app  ")).toBe(
      "make a travel app",
    );
    expect(peekShowcaseAgentPrompt()).toBe("make a travel app");
    expect(peekShowcaseAgentPrompt()).toBe("make a travel app");
    clearShowcaseAgentPrompt();
    expect(peekShowcaseAgentPrompt()).toBeNull();
  });

  it("rejects an empty prompt without changing an existing handoff", () => {
    sessionStorage.setItem("pen:showcase-agent-prompt:v1", "keep me");

    expect(storeShowcaseAgentPrompt("   ")).toBeNull();
    expect(peekShowcaseAgentPrompt()).toBe("keep me");
  });

  it("returns null when there is no handoff", () => {
    expect(peekShowcaseAgentPrompt()).toBeNull();
  });

  it("does not throw when web storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn(() => {
        throw new DOMException("Blocked", "SecurityError");
      }),
      removeItem: vi.fn(() => {
        throw new DOMException("Blocked", "SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("Blocked", "SecurityError");
      }),
    });

    expect(storeShowcaseAgentPrompt("make an app")).toBeNull();
    expect(peekShowcaseAgentPrompt()).toBeNull();
  });
});
