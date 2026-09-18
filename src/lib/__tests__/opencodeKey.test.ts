import { describe, it, expect, afterEach, vi } from "vitest";
import {
  clearOpenCodeKey,
  getOpenCodeKey,
  hasOpenCodeKey,
  setOpenCodeKey,
  subscribeOpenCodeKey,
} from "@/lib/opencodeKey";

afterEach(() => {
  clearOpenCodeKey();
  vi.restoreAllMocks();
});

describe("opencodeKey storage", () => {
  it("has no key by default", () => {
    expect(getOpenCodeKey()).toBeNull();
    expect(hasOpenCodeKey()).toBe(false);
  });

  it("saves and reads back a key", () => {
    setOpenCodeKey("sk-test-123");
    expect(getOpenCodeKey()).toBe("sk-test-123");
    expect(hasOpenCodeKey()).toBe(true);
  });

  it("trims the key on save", () => {
    setOpenCodeKey("  sk-test-456  ");
    expect(getOpenCodeKey()).toBe("sk-test-456");
  });

  it("treats a blank/whitespace-only key as no key at all", () => {
    setOpenCodeKey("sk-test-789");
    expect(hasOpenCodeKey()).toBe(true);

    setOpenCodeKey("   ");
    expect(getOpenCodeKey()).toBeNull();
    expect(hasOpenCodeKey()).toBe(false);
  });

  it("clearOpenCodeKey removes a saved key", () => {
    setOpenCodeKey("sk-test-abc");
    expect(hasOpenCodeKey()).toBe(true);

    clearOpenCodeKey();
    expect(getOpenCodeKey()).toBeNull();
    expect(hasOpenCodeKey()).toBe(false);
  });

  it("clearOpenCodeKey is a no-op when nothing is stored", () => {
    expect(() => clearOpenCodeKey()).not.toThrow();
    expect(getOpenCodeKey()).toBeNull();
  });
});

describe("opencodeKey subscription", () => {
  it("notifies subscribers on setOpenCodeKey and clearOpenCodeKey", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOpenCodeKey(listener);

    setOpenCodeKey("sk-notify-1");
    expect(listener).toHaveBeenCalledTimes(1);

    clearOpenCodeKey();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setOpenCodeKey("sk-notify-2");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("opencodeKey with a throwing localStorage", () => {
  function stubThrowingStorage() {
    const throwing: Storage = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      clear: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      key: () => null,
      length: 0,
    };
    vi.stubGlobal("localStorage", throwing);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getOpenCodeKey/hasOpenCodeKey degrade to 'no key' instead of throwing", () => {
    stubThrowingStorage();
    expect(() => getOpenCodeKey()).not.toThrow();
    expect(getOpenCodeKey()).toBeNull();
    expect(hasOpenCodeKey()).toBe(false);
  });

  it("setOpenCodeKey does not throw and still notifies listeners", () => {
    stubThrowingStorage();
    const listener = vi.fn();
    subscribeOpenCodeKey(listener);
    expect(() => setOpenCodeKey("sk-private-mode")).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
    // The write silently failed — reading back must not lie about having
    // saved it.
    expect(getOpenCodeKey()).toBeNull();
  });

  it("clearOpenCodeKey does not throw when storage is blocked", () => {
    stubThrowingStorage();
    expect(() => clearOpenCodeKey()).not.toThrow();
  });
});
