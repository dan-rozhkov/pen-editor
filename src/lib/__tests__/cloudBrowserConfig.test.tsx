import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCloudBrowserConfigCache, useBrowserAgentAvailable } from "../cloudBrowserConfig";

beforeEach(resetCloudBrowserConfigCache);
afterEach(() => {
  vi.unstubAllGlobals();
  delete window.penDesktop;
});

function stubConfig(enabled: boolean) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ enabled }))));
}

describe("useBrowserAgentAvailable", () => {
  it("is true on the desktop shell without asking the backend", () => {
    stubConfig(false);
    window.penDesktop = { onMenuCommand: () => () => {}, browser: {} } as never;
    const { result } = renderHook(() => useBrowserAgentAvailable());
    expect(result.current).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is true on the web when the cloud browser is enabled", async () => {
    stubConfig(true);
    const { result } = renderHook(() => useBrowserAgentAvailable());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("stays false on the web when the cloud browser is disabled", async () => {
    stubConfig(false);
    const { result } = renderHook(() => useBrowserAgentAvailable());
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
