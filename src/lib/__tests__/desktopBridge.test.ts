import { describe, it, expect, vi, afterEach } from "vitest";
import { initDesktopBridge } from "@/lib/desktopBridge";
import * as registry from "@/lib/commands/registry";

describe("initDesktopBridge", () => {
  afterEach(() => {
    delete (window as { penDesktop?: unknown }).penDesktop;
    vi.restoreAllMocks();
  });

  it("is a no-op on the web (no window.penDesktop)", () => {
    expect(() => initDesktopBridge()()).not.toThrow();
  });

  it("subscribes and dispatches command ids through the palette registry", () => {
    let handler: ((id: string) => void) | undefined;
    const unsubscribe = vi.fn();
    (window as { penDesktop?: unknown }).penDesktop = {
      onMenuCommand: (cb: (id: string) => void) => {
        handler = cb;
        return unsubscribe;
      },
    };
    const run = vi.fn();
    vi.spyOn(registry, "getCommands").mockReturnValue([
      { id: "file-open", label: "Open…", group: "File", run },
    ]);

    const dispose = initDesktopBridge();
    handler!("file-open");
    expect(run).toHaveBeenCalledTimes(1);

    dispose();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("warns and survives an unknown command id", () => {
    let handler: ((id: string) => void) | undefined;
    (window as { penDesktop?: unknown }).penDesktop = {
      onMenuCommand: (cb: (id: string) => void) => {
        handler = cb;
        return () => {};
      },
    };
    vi.spyOn(registry, "getCommands").mockReturnValue([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    initDesktopBridge();
    expect(() => handler!("no-such-command")).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});
