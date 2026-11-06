import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { isTabPath, isWorkspaceFrame, WORKSPACE_PATH } from "../frame";
import { RETURN_FLAG_TTL_MS, WORKSPACE_RETURN_KEY, WorkspaceFrameGuard } from "../WorkspaceFrameGuard";

const realParent = Object.getOwnPropertyDescriptor(window, "parent");

function setParent(value: unknown): void {
  Object.defineProperty(window, "parent", { configurable: true, value });
}
function framedBy(pathname: string, origin = window.location.origin): unknown {
  return { location: { pathname, origin } };
}

afterEach(() => {
  window.sessionStorage.clear();
  delete (window as { penDesktop?: unknown }).penDesktop;
  if (realParent) Object.defineProperty(window, "parent", realParent);
  else delete (window as unknown as { parent?: unknown }).parent;
  vi.restoreAllMocks();
});

describe("isWorkspaceFrame", () => {
  it("is false at top level", () => {
    setParent(window);
    expect(isWorkspaceFrame()).toBe(false);
  });
  it("is true when framed by /workspace", () => {
    setParent(framedBy(WORKSPACE_PATH));
    expect(isWorkspaceFrame()).toBe(true);
  });
  it("tolerates a trailing slash", () => {
    setParent(framedBy(`${WORKSPACE_PATH}/`));
    expect(isWorkspaceFrame()).toBe(true);
  });
  it("is false when framed by another path", () => {
    setParent(framedBy("/app"));
    expect(isWorkspaceFrame()).toBe(false);
  });
  it("is false for a different-origin parent", () => {
    setParent(framedBy(WORKSPACE_PATH, "https://evil.example"));
    expect(isWorkspaceFrame()).toBe(false);
  });
  it("is false when reading the parent throws", () => {
    setParent({
      get location(): never {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(isWorkspaceFrame()).toBe(false);
  });
});

describe("WorkspaceFrameGuard", () => {
  function mount(path: string): ReturnType<typeof vi.fn> {
    const replace = vi.fn();
    setParent(framedBy(WORKSPACE_PATH));
    Object.defineProperty(window, "top", { configurable: true, value: { location: { replace } } });
    render(
      <MemoryRouter initialEntries={[path]}>
        <WorkspaceFrameGuard />
      </MemoryRouter>,
    );
    return replace;
  }

  it.each(["/app", "/doc", "/workflow", "/settings", "/trace", "/trace/abc", "/agent", "/agent/"])("keeps %s in the frame", (p) => {
    expect(mount(p)).not.toHaveBeenCalled();
  });

  it.each(["/sign-in", "/account", "/", "/consent"])("moves %s to the top window", (p) => {
    expect(mount(p)).toHaveBeenCalledWith(window.location.href);
  });

  it.each(["/sign-in", "/account", "/consent"])("sets the return flag before %s leaves the frame", (p) => {
    mount(p);
    expect(Number(window.sessionStorage.getItem(WORKSPACE_RETURN_KEY))).toBeGreaterThan(0);
  });

  it("does not set the return flag for /", () => {
    mount("/");
    expect(window.sessionStorage.getItem(WORKSPACE_RETURN_KEY)).toBeNull();
  });

  describe("in the top window", () => {
    function mountTop(path: string): ReturnType<typeof vi.fn> {
      const replace = vi.fn();
      setParent(window);
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...window.location, replace, href: window.location.href },
      });
      render(
        <MemoryRouter initialEntries={[path]}>
          <WorkspaceFrameGuard />
        </MemoryRouter>,
      );
      return replace;
    }
    const realLocation = Object.getOwnPropertyDescriptor(window, "location");
    afterEach(() => {
      if (realLocation) Object.defineProperty(window, "location", realLocation);
    });

    it("returns to /workspace from a tab route when the flag is set, and clears it", () => {
      window.sessionStorage.setItem(WORKSPACE_RETURN_KEY, String(Date.now()));
      const replace = mountTop("/app");
      expect(replace).toHaveBeenCalledWith(WORKSPACE_PATH);
      expect(window.sessionStorage.getItem(WORKSPACE_RETURN_KEY)).toBeNull();
    });

    it("keeps the flag on a non-tab route and does nothing without it", () => {
      window.sessionStorage.setItem(WORKSPACE_RETURN_KEY, String(Date.now()));
      expect(mountTop("/sign-in")).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem(WORKSPACE_RETURN_KEY)).not.toBeNull();
      window.sessionStorage.clear();
      cleanup();
      expect(mountTop("/app")).not.toHaveBeenCalled();
    });

    it("ignores and removes a flag older than 15 minutes", () => {
      window.sessionStorage.setItem(WORKSPACE_RETURN_KEY, String(Date.now() - RETURN_FLAG_TTL_MS - 1000));
      expect(mountTop("/app")).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem(WORKSPACE_RETURN_KEY)).toBeNull();
    });

    it("ignores a legacy or malformed flag value", () => {
      window.sessionStorage.setItem(WORKSPACE_RETURN_KEY, "1");
      expect(mountTop("/app")).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem(WORKSPACE_RETURN_KEY)).toBeNull();
    });

    it("clears the flag on arrival at /workspace, so a later /app visit is not redirected", () => {
      window.sessionStorage.setItem(WORKSPACE_RETURN_KEY, String(Date.now()));
      expect(mountTop("/workspace")).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem(WORKSPACE_RETURN_KEY)).toBeNull();
      cleanup();
      expect(mountTop("/app")).not.toHaveBeenCalled();
    });

    it("does not send the top window back to /workspace from /agent", () => {
      window.sessionStorage.setItem(WORKSPACE_RETURN_KEY, String(Date.now()));
      expect(mountTop("/agent")).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem(WORKSPACE_RETURN_KEY)).not.toBeNull();
    });

    it("does nothing in the desktop shell", () => {
      window.sessionStorage.setItem(WORKSPACE_RETURN_KEY, String(Date.now()));
      (window as { penDesktop?: unknown }).penDesktop = {};
      expect(mountTop("/app")).not.toHaveBeenCalled();
    });
  });

  it("does nothing outside a workspace frame", () => {
    const replace = vi.fn();
    setParent(window);
    Object.defineProperty(window, "top", { configurable: true, value: { location: { replace } } });
    render(
      <MemoryRouter initialEntries={["/sign-in"]}>
        <WorkspaceFrameGuard />
      </MemoryRouter>,
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("isTabPath matches the tab routes only", () => {
    expect(isTabPath("/trace/x")).toBe(true);
    expect(isTabPath("/traces")).toBe(false);
    expect(isTabPath("/application")).toBe(false);
    // The chat panel is allowed in a frame but is not a tab route (top-window return logic).
    expect(isTabPath("/agent")).toBe(false);
  });
});
