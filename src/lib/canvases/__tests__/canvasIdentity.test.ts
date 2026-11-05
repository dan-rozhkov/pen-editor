import { afterEach, describe, expect, it } from "vitest";
import { ensureCanvasIdInUrl } from "../canvasIdentity";

describe("ensureCanvasIdInUrl per-frame session key", () => {
  afterEach(() => {
    window.name = "";
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/app");
  });

  it("keeps the plain key when window.name is empty", () => {
    window.name = "";
    window.history.replaceState(null, "", "/app?canvas=cv_plain");
    ensureCanvasIdInUrl();
    expect(window.sessionStorage.getItem("pen.canvasId")).toBe("cv_plain");
  });

  it("uses a key per frame name, so two frames never read each other's id", () => {
    window.name = "pen-tab-1";
    window.history.replaceState(null, "", "/app?canvas=cv_one");
    ensureCanvasIdInUrl();
    window.name = "pen-tab-2";
    window.history.replaceState(null, "", "/app");
    const two = ensureCanvasIdInUrl();
    expect(two).not.toBe("cv_one");
    window.name = "pen-tab-1";
    window.history.replaceState(null, "", "/app");
    expect(ensureCanvasIdInUrl()).toBe("cv_one");
    expect(window.sessionStorage.getItem("pen.canvasId:pen-tab-1")).toBe("cv_one");
    expect(window.sessionStorage.getItem("pen.canvasId")).toBeNull();
  });
});
