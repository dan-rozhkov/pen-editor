import { describe, expect, it, beforeEach } from "vitest";
import { getUserId } from "@/lib/userId";

describe("getUserId", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("creates a uuid on first run and persists it", () => {
    const id = getUserId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(localStorage.getItem("pen.userId")).toBe(id);
  });

  it("returns the same id on every later call", () => {
    expect(getUserId()).toBe(getUserId());
  });

  it("reuses an id already in localStorage", () => {
    localStorage.setItem("pen.userId", "existing-id");
    expect(getUserId()).toBe("existing-id");
  });

  it("still issues an id when crypto.randomUUID is unavailable (insecure context)", () => {
    // Simulate the secure-context gate: over LAN http the property is absent
    // at runtime even though the type declares it.
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const id = getUserId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      expect(localStorage.getItem("pen.userId")).toBe(id);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
