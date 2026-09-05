import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  announceSurfaceInstalled,
  announceToolsRegistered,
  resetAnnounceForTests,
} from "@/lib/webmcp/announce";
import type { ModelContextLike } from "@/lib/webmcp/types";

/**
 * A typed reference to the same method name the banner's snippet quotes.
 * If `executeTool` is ever renamed on `ModelContextLike`, this line stops
 * compiling — the test would fail to typecheck rather than pass on a stale
 * hardcoded string quoted twice.
 */
const EXECUTE_TOOL_METHOD: keyof ModelContextLike = "executeTool";

function infoSpy() {
  return vi.spyOn(console, "info").mockImplementation(() => {});
}

// vi.spyOn returns the same instance if console.info is already spied, so a
// leftover spy from an earlier test would keep accumulating calls across
// tests; restore it fully between tests instead of only clearing calls.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("announceSurfaceInstalled", () => {
  it("prints exactly one console.info with every line prefixed", () => {
    const spy = infoSpy();
    announceSurfaceInstalled();

    expect(spy).toHaveBeenCalledTimes(1);
    const message = spy.mock.calls[0][0] as string;
    for (const line of message.split("\n")) {
      expect(line.startsWith("[webmcp] ")).toBe(true);
    }
  });
});

describe("announceToolsRegistered", () => {
  beforeEach(resetAnnounceForTests);

  it("prints exactly one console.info with every line prefixed", () => {
    const spy = infoSpy();
    announceToolsRegistered({ registered: ["get_editor_state"], withheld: [] });

    expect(spy).toHaveBeenCalledTimes(1);
    const message = spy.mock.calls[0][0] as string;
    for (const line of message.split("\n")) {
      expect(line.startsWith("[webmcp] ")).toBe(true);
    }
  });

  it("names every registered tool", () => {
    const spy = infoSpy();
    announceToolsRegistered({
      registered: ["get_editor_state", "batch_design", "set_variables"],
      withheld: [],
    });

    const message = spy.mock.calls[0][0] as string;
    expect(message).toContain("get_editor_state");
    expect(message).toContain("batch_design");
    expect(message).toContain("set_variables");
  });

  it("includes a copy-pasteable snippet using the real method name", () => {
    const spy = infoSpy();
    announceToolsRegistered({ registered: ["get_editor_state"], withheld: [] });

    const message = spy.mock.calls[0][0] as string;
    expect(message).toContain(`navigator.modelContext.${EXECUTE_TOOL_METHOD}(`);
    // Arguments are a JSON string, not an object — the snippet must show a
    // quoted string literal, not `{}` passed as a bare object.
    expect(message).toMatch(/\("[^"]+",\s*"\{\}"\)/);
  });

  it("mentions withheld tools only when there are some", () => {
    const spyWithout = infoSpy();
    announceToolsRegistered({ registered: ["get_editor_state"], withheld: [] });
    expect(spyWithout.mock.calls[0][0]).not.toContain("withheld");
    spyWithout.mockRestore();

    resetAnnounceForTests();

    const spyWith = infoSpy();
    announceToolsRegistered({
      registered: ["get_editor_state"],
      withheld: ["batch_design"],
    });
    const message = spyWith.mock.calls[0][0] as string;
    expect(message).toContain("withheld");
    expect(message).toContain("batch_design");
  });

  it("links to the schema manifest", () => {
    const spy = infoSpy();
    announceToolsRegistered({ registered: ["get_editor_state"], withheld: [] });

    expect(spy.mock.calls[0][0]).toContain("webmcp.json");
  });

  it("does not print again for an unchanged registered+withheld set", () => {
    const spy = infoSpy();
    announceToolsRegistered({ registered: ["get_editor_state"], withheld: [] });
    announceToolsRegistered({ registered: ["get_editor_state"], withheld: [] });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("prints again when the set changes", () => {
    const spy = infoSpy();
    announceToolsRegistered({ registered: ["get_editor_state"], withheld: [] });
    announceToolsRegistered({
      registered: ["get_editor_state", "batch_design"],
      withheld: [],
    });

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("resetAnnounceForTests lifts the dedup", () => {
    const spy = infoSpy();
    announceToolsRegistered({ registered: ["get_editor_state"], withheld: [] });
    resetAnnounceForTests();
    announceToolsRegistered({ registered: ["get_editor_state"], withheld: [] });

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
