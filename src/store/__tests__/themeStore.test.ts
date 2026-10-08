import { beforeEach, describe, expect, it } from "vitest";
import { useThemeStore } from "@/store/themeStore";

beforeEach(() => useThemeStore.setState({ activeTheme: "light", modeContext: { theme: "light" } }));

describe("themeStore mode context", () => {
  it("starts light", () => {
    expect(useThemeStore.getState().modeContext).toEqual({ theme: "light" });
  });
  it("setActiveTheme updates both the mirror and the context", () => {
    useThemeStore.getState().setActiveTheme("dark");
    expect(useThemeStore.getState().activeTheme).toBe("dark");
    expect(useThemeStore.getState().modeContext).toEqual({ theme: "dark" });
  });
  it("setCollectionMode on another collection leaves activeTheme alone", () => {
    useThemeStore.getState().setCollectionMode("brand", "globex");
    expect(useThemeStore.getState().modeContext).toEqual({ theme: "light", brand: "globex" });
    expect(useThemeStore.getState().activeTheme).toBe("light");
  });
  it("setCollectionMode on theme moves the mirror", () => {
    useThemeStore.getState().setCollectionMode("theme", "dark");
    expect(useThemeStore.getState().activeTheme).toBe("dark");
  });
  it("setModeContext sets both atomically; no theme key mirrors to light", () => {
    const seen: string[] = [];
    const unsub = useThemeStore.subscribe((s) => seen.push(`${s.activeTheme}|${JSON.stringify(s.modeContext)}`));
    useThemeStore.getState().setModeContext({ theme: "dark", brand: "acme" });
    expect(seen).toEqual(['dark|{"theme":"dark","brand":"acme"}']);
    useThemeStore.getState().setModeContext({ brand: "acme" });
    expect(useThemeStore.getState().activeTheme).toBe("light");
    unsub();
  });
  it("a raw setState of activeTheme (legacy callers) keeps the context in step", () => {
    useThemeStore.setState({ activeTheme: "dark" });
    expect(useThemeStore.getState().modeContext.theme).toBe("dark");
  });
  it("setModeContext copies its input", () => {
    const ctx = { theme: "dark" };
    useThemeStore.getState().setModeContext(ctx);
    ctx.theme = "light";
    expect(useThemeStore.getState().modeContext.theme).toBe("dark");
  });
});
