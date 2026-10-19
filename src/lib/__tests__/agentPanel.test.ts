import { afterEach, describe, expect, it, vi } from "vitest";
import { isAgentPanelHost, isAgentRoutePath, isDocRoutePath } from "../agentPanel";

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.penAgentPanel;
});

describe("isAgentPanelHost", () => {
  it("is false in production without the preload marker", () => {
    vi.stubEnv("DEV", false);
    expect(isAgentPanelHost()).toBe(false);
  });
  it("is true in production inside the agent panel", () => {
    vi.stubEnv("DEV", false);
    window.penAgentPanel = { version: 1 };
    expect(isAgentPanelHost()).toBe(true);
  });
  it("is true in dev", () => {
    vi.stubEnv("DEV", true);
    expect(isAgentPanelHost()).toBe(true);
  });
});

describe("isAgentRoutePath", () => {
  it("matches /agent only", () => {
    expect(isAgentRoutePath("/agent", "/")).toBe(true);
    expect(isAgentRoutePath("/agent/", "/")).toBe(true);
    expect(isAgentRoutePath("/app", "/")).toBe(false);
    expect(isAgentRoutePath("/agents", "/")).toBe(false);
    expect(isAgentRoutePath("/x/agent", "/x/")).toBe(true);
  });
});

describe("isDocRoutePath", () => {
  it("matches /doc under the base only", () => {
    expect(isDocRoutePath("/doc", "/")).toBe(true);
    expect(isDocRoutePath("/doc/", "/")).toBe(true);
    expect(isDocRoutePath("/docs", "/")).toBe(false);
    expect(isDocRoutePath("/x/doc", "/x/")).toBe(true);
    expect(isDocRoutePath("/doc", "/x/")).toBe(false);
  });
});
