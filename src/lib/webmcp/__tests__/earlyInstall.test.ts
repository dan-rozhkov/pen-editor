import { describe, it, expect, beforeEach } from "vitest";
import {
  installModelContextForEditorRoute,
  isEditorRoute,
} from "@/lib/webmcp/earlyInstall";
import { getModelContext } from "@/lib/webmcp/polyfill";
import { registerWebMcpTools } from "@/lib/webmcp/registerTools";
import { WEBMCP_TOOL_SPECS } from "@/lib/webmcp/schemas";

function clearModelContext(): void {
  Reflect.deleteProperty(navigator, "modelContext");
  Reflect.deleteProperty(document, "modelContext");
}

describe("isEditorRoute", () => {
  it("matches the routes where an editor mounts", () => {
    expect(isEditorRoute("/app")).toBe(true);
    expect(isEditorRoute("/c/abc123")).toBe(true);
  });

  // Advertising a context on a page that will never register a tool is its
  // own kind of lie, and would drag this module into the showcase bundle's
  // reason for existing.
  it("does not match the showcase", () => {
    expect(isEditorRoute("/")).toBe(false);
    expect(isEditorRoute("/anything-else")).toBe(false);
  });
});

describe("installModelContextForEditorRoute", () => {
  beforeEach(clearModelContext);

  it("installs a context on an editor route, before any tool exists", async () => {
    expect(installModelContextForEditorRoute("/app")).toBe(true);

    const context = getModelContext();
    expect(context).toBeDefined();
    // The distinction the whole change rests on: an empty list means "not
    // yet", a missing API means "never".
    expect(await context?.getTools()).toEqual([]);
  });

  it("installs nothing on the showcase", () => {
    expect(installModelContextForEditorRoute("/")).toBe(false);
    expect(getModelContext()).toBeUndefined();
  });

  it("leaves a native model context alone", () => {
    const native = { registerTool: () => {}, getTools: () => {}, executeTool: () => {} };
    Object.defineProperty(navigator, "modelContext", { value: native, configurable: true });

    installModelContextForEditorRoute("/app");

    expect(getModelContext()).toBe(native);
  });
});

describe("handing over to startWebMcp", () => {
  beforeEach(clearModelContext);

  // The early install and the later registration must meet on the same
  // object: a second install would drop everything registered against the
  // first, and the empty list would never fill.
  it("registers the tools into the context installed early", async () => {
    installModelContextForEditorRoute("/app");
    const early = getModelContext();
    expect(await early?.getTools()).toEqual([]);

    await registerWebMcpTools();

    expect(getModelContext()).toBe(early);
    expect((await early?.getTools())?.length).toBe(WEBMCP_TOOL_SPECS.length);
  });
});
