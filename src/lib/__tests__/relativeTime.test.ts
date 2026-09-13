import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { formatRelativeTime } from "../relativeTime";

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for timestamps under a minute old", () => {
    expect(formatRelativeTime(Date.now())).toBe("just now");
    expect(formatRelativeTime(Date.now() - 30_000)).toBe("just now");
  });

  it("formats minutes", () => {
    expect(formatRelativeTime(Date.now() - 5 * 60_000)).toBe("5m ago");
    expect(formatRelativeTime(Date.now() - 59 * 60_000)).toBe("59m ago");
  });

  it("formats hours", () => {
    expect(formatRelativeTime(Date.now() - 2 * 60 * 60_000)).toBe("2h ago");
    expect(formatRelativeTime(Date.now() - 23 * 60 * 60_000)).toBe("23h ago");
  });

  it("formats days", () => {
    expect(formatRelativeTime(Date.now() - 3 * 24 * 60 * 60_000)).toBe("3d ago");
  });

  it("clamps a future timestamp to 'just now' instead of going negative", () => {
    expect(formatRelativeTime(Date.now() + 60_000)).toBe("just now");
  });
});
