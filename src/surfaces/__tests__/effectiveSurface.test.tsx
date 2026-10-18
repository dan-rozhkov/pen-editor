import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useSharedViewStore } from "@/store/sharedViewStore";
import { useUIVisibilityStore } from "@/store/uiVisibilityStore";
import { useSurfaceStore } from "@/store/surfaceStore";
import {
  canSwitchSurfaces,
  getEffectiveSurfaceId,
  isCanvasInputActive,
  useCanSwitchSurfaces,
  useEffectiveSurfaceId,
} from "../effectiveSurface";

function setMobile(mobile: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) => ({ matches: mobile, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  setMobile(false);
  useEditorModeStore.setState({ mode: "edit" });
  useDevModeStore.setState({ active: false });
  useSharedViewStore.setState({ isSharedView: false });
  useUIVisibilityStore.setState({ isUIHidden: false });
  useSurfaceStore.setState({ activeSurfaceId: "browser", browserChatId: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.penDesktop;
  useSurfaceStore.setState({ activeSurfaceId: "canvas", browserChatId: null });
});

const BLOCKERS: Array<[string, () => void]> = [
  ["mobile", () => setMobile(true)],
  ["view mode", () => useEditorModeStore.setState({ mode: "view" })],
  ["present mode", () => useEditorModeStore.setState({ mode: "present" })],
  ["dev mode", () => useDevModeStore.setState({ active: true })],
  ["the shared viewer", () => useSharedViewStore.setState({ isSharedView: true })],
  ["hidden UI", () => useUIVisibilityStore.setState({ isUIHidden: true })],
  [
    "an unavailable surface (desktop shell)",
    () => {
      window.penDesktop = { onMenuCommand: () => () => {}, browser: {} } as never;
    },
  ],
];

describe("effective surface", () => {
  it("is the requested surface on a desktop-width, editable editor with the UI visible", () => {
    expect(canSwitchSurfaces()).toBe(true);
    expect(getEffectiveSurfaceId()).toBe("browser");
    expect(isCanvasInputActive()).toBe(false);
    expect(renderHook(() => useEffectiveSurfaceId()).result.current).toBe("browser");
    expect(renderHook(() => useCanSwitchSurfaces()).result.current).toBe(true);
  });

  it.each(BLOCKERS)("is the canvas under %s even though the browser is stored", (_name, apply) => {
    apply();
    expect(getEffectiveSurfaceId()).toBe("canvas");
    expect(isCanvasInputActive()).toBe(true);
    expect(renderHook(() => useEffectiveSurfaceId()).result.current).toBe("canvas");
  });

  it.each(BLOCKERS.filter(([name]) => !name.startsWith("an unavailable")))(
    "does not allow switching under %s",
    (_name, apply) => {
      apply();
      expect(canSwitchSurfaces()).toBe(false);
      expect(renderHook(() => useCanSwitchSurfaces()).result.current).toBe(false);
    },
  );
});
