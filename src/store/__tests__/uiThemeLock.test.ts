import { describe, expect, it } from "vitest";
import { setUIThemeTransient, useUIThemeStore } from "@/store/uiThemeStore";
import { useSceneStore } from "@/store/sceneStore";

// Own file on purpose: the host lock is module state and must not leak into
// the other uiThemeStore tests.
describe("host theme lock (embed widget)", () => {
  it("wins over later setUITheme calls (e.g. restoring a document saved in light) and never persists", () => {
    localStorage.setItem("ui-theme", "light");
    setUIThemeTransient("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    // openDocumentIntoEditor applies the document's saved theme this way.
    useUIThemeStore.getState().setUITheme("light");
    useUIThemeStore.getState().toggleUITheme();

    expect(useUIThemeStore.getState().uiTheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("ui-theme")).toBe("light");
  });

  it("moves a default page background to the host theme, but leaves a custom one", () => {
    useSceneStore.getState().setPageBackground("#F5F5F5");
    setUIThemeTransient("dark");
    expect(useSceneStore.getState().pageBackground).toBe("#1a1a1a");

    useSceneStore.getState().setPageBackground("#ff00aa");
    setUIThemeTransient("light");
    expect(useSceneStore.getState().pageBackground).toBe("#ff00aa");
  });

  it("follows the host when it switches theme", () => {
    setUIThemeTransient("light");
    expect(useUIThemeStore.getState().uiTheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
