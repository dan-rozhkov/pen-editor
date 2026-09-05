import { describe, it, expect, beforeEach, vi } from "vitest";

const executeToolCall = vi.hoisted(() => vi.fn(async () => "{}"));
vi.mock("@/hooks/useDesignChat", () => ({ executeToolCall }));

import { installModelContextPolyfill, getModelContext } from "@/lib/webmcp/polyfill";
import {
  READ_ONLY_REFUSAL,
  SURFACE_INACTIVE,
  registerWebMcpTools,
  setSurfaceActive,
} from "@/lib/webmcp/registerTools";
import { WEBMCP_TOOL_SPECS } from "@/lib/webmcp/schemas";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSharedViewStore } from "@/store/sharedViewStore";

const MUTATING = WEBMCP_TOOL_SPECS.filter((spec) => spec.mutating).map((spec) => spec.name);

async function freshContext() {
  Reflect.deleteProperty(navigator, "modelContext");
  Reflect.deleteProperty(document, "modelContext");
  installModelContextPolyfill();
  return getModelContext();
}

async function invoke(name: string, args: unknown): Promise<unknown> {
  const context = getModelContext();
  const tool = (await context!.getTools()).find((t) => t.name === name);
  if (!tool) throw new Error(`${name} was not registered`);
  return context!.executeTool(tool, JSON.stringify(args));
}

describe("registerWebMcpTools", () => {
  beforeEach(async () => {
    executeToolCall.mockClear();
    executeToolCall.mockResolvedValue("{}");
    useSharedViewStore.setState({ isSharedView: false });
    useEditorModeStore.getState().exitToEdit();
    vi.spyOn(console, "error").mockImplementation(() => {});
    setSurfaceActive(true);
    await freshContext();
  });

  it("registers every spec on an editable canvas", async () => {
    const result = await registerWebMcpTools();

    expect(result.registered).toEqual(WEBMCP_TOOL_SPECS.map((s) => s.name));
    expect(result.withheld).toEqual([]);
  });

  it("publishes each tool with a description, a closed object schema, and annotations", async () => {
    await registerWebMcpTools();

    for (const tool of await getModelContext()!.getTools()) {
      expect(tool.description.length, tool.name).toBeGreaterThan(0);
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
      expect(typeof tool.annotations.readOnly, tool.name).toBe("boolean");
    }
  });

  it("annotates read-only and mutating tools to match their spec", async () => {
    await registerWebMcpTools();

    for (const tool of await getModelContext()!.getTools()) {
      const spec = WEBMCP_TOOL_SPECS.find((s) => s.name === tool.name);
      expect(tool.annotations.readOnly, tool.name).toBe(!spec!.mutating);
    }
  });

  it("routes an invocation through executeToolCall with a webmcp source", async () => {
    executeToolCall.mockResolvedValue(JSON.stringify({ nodes: [] }));
    await registerWebMcpTools();

    const result = await invoke("batch_get", { nodeIds: ["n1"] });

    expect(executeToolCall).toHaveBeenCalledWith(
      "batch_get",
      { nodeIds: ["n1"] },
      undefined,
      "webmcp"
    );
    expect(result).toEqual({ nodes: [] });
  });

  it("returns a non-JSON handler result unchanged rather than failing", async () => {
    executeToolCall.mockResolvedValue("plain text");
    await registerWebMcpTools();

    expect(await invoke("get_variables", {})).toBe("plain text");
  });

  // executeToolCall resolves even when the handler failed; reporting that as
  // a plain result would tell the agent an edit landed when it did not.
  it("flags a handler failure as an error result rather than a success", async () => {
    executeToolCall.mockResolvedValue(JSON.stringify({ error: "no such node" }));
    await registerWebMcpTools();

    expect(await invoke("batch_get", { nodeIds: ["nope"] })).toEqual({
      isError: true,
      error: "no such node",
    });
  });

  // A rejection would be flattened to "Tool invocation failed" by the WebMCP
  // layer, losing the resume point a partially applied script reports.
  it("preserves the handler's own error fields alongside the flag", async () => {
    executeToolCall.mockResolvedValue(
      JSON.stringify({ error: "Execution error: line 12", completedOperations: 11, truncated: true })
    );
    await registerWebMcpTools();

    expect(await invoke("batch_design", { operations: "I(document, {})" })).toEqual({
      isError: true,
      error: "Execution error: line 12",
      completedOperations: 11,
      truncated: true,
    });
  });

  it("refuses input the schema does not allow, without calling the handler", async () => {
    await registerWebMcpTools();

    for (const [name, args] of [
      ["batch_get", { surprise: true }],
      ["get_editor_state", {}],
      ["batch_design", { operations: 42 }],
    ] as const) {
      const result = (await invoke(name, args)) as { isError?: boolean; error?: string };
      expect(result.isError, name).toBe(true);
      expect(result.error, name).toContain(`Invalid input for ${name}`);
    }
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  // The point of returning rather than throwing: the caller can read why.
  it("names the offending field so a caller can correct itself", async () => {
    await registerWebMcpTools();

    const result = (await invoke("batch_get", { surprise: true })) as { error: string };

    expect(result.error).toContain("surprise");
    expect(result.error).toContain("unknown field");
  });

  describe("read-only canvases", () => {
    it("withholds the mutating tools in the shared viewer", async () => {
      useSharedViewStore.setState({ isSharedView: true });

      const result = await registerWebMcpTools();

      expect(result.withheld).toEqual(MUTATING);
      const names = (await getModelContext()!.getTools()).map((t) => t.name);
      for (const name of MUTATING) expect(names).not.toContain(name);
    });

    // `/app?view` never sets the shared-view flag; only the editor mode says
    // the canvas is read-only there.
    it("withholds the mutating tools in ?view mode", async () => {
      useEditorModeStore.getState().enterView();

      expect((await registerWebMcpTools()).withheld).toEqual(MUTATING);
    });

    // attach_local_repo never touches the scene graph, but it writes session
    // state (repoContextStore) the design agent's other tools then read from
    // — a stranger's agent on a shared /c/:id canvas must not be able to push
    // a repo into someone else's session, so it gets the same treatment as
    // batch_design/set_variables even though it isn't a scene mutation.
    it("withholds attach_local_repo specifically in the shared viewer", async () => {
      useSharedViewStore.setState({ isSharedView: true });

      const result = await registerWebMcpTools();

      expect(result.withheld).toContain("attach_local_repo");
      const names = (await getModelContext()!.getTools()).map((t) => t.name);
      expect(names).not.toContain("attach_local_repo");
    });

    it("refuses attach_local_repo when the canvas becomes read-only after registration", async () => {
      await registerWebMcpTools();
      useSharedViewStore.setState({ isSharedView: true });

      expect(await invoke("attach_local_repo", { name: "probe" })).toEqual({
        isError: true,
        error: READ_ONLY_REFUSAL,
      });
      expect(executeToolCall).not.toHaveBeenCalled();
    });

    it("still publishes the read-only tools", async () => {
      useSharedViewStore.setState({ isSharedView: true });

      const result = await registerWebMcpTools();

      expect(result.registered).toContain("batch_get");
      expect(result.registered).toContain("get_editor_state");
    });

    // Registration-time gating alone is a race: the shared viewer sets its
    // flag from a parent effect while the editor mounts lazily underneath.
    it("refuses a mutating call when the canvas becomes read-only after registration", async () => {
      await registerWebMcpTools();
      useSharedViewStore.setState({ isSharedView: true });

      expect(await invoke("batch_design", { operations: "I(document, {})" })).toEqual({
        isError: true,
        error: READ_ONLY_REFUSAL,
      });
      expect(executeToolCall).not.toHaveBeenCalled();
    });

    it("leaves read-only tools callable on a read-only canvas", async () => {
      executeToolCall.mockResolvedValue(JSON.stringify({ ok: true }));
      await registerWebMcpTools();
      useSharedViewStore.setState({ isSharedView: true });

      await expect(invoke("get_variables", {})).resolves.toEqual({ ok: true });
    });

    it("names the read-only refusal so a developer can find it in the console", () => {
      expect(READ_ONLY_REFUSAL).toMatch(/read-only|not editable/i);
    });

    // The read tools stay published on a shared canvas, so what they return
    // has to be narrowed to what the viewer's own screen can show. Unit
    // coverage of the rules is in sharedViewRedaction.test.ts; this asserts
    // only that the WebMCP path applies them at all.
    it("narrows read results to visible content on someone else's canvas", async () => {
      executeToolCall.mockResolvedValue(
        JSON.stringify({ roots: [{ id: "n1", type: "embed", htmlContent: "<b>payload</b>" }] })
      );
      await registerWebMcpTools();
      useSharedViewStore.setState({ isSharedView: true });

      const result = await invoke("batch_get", { nodeIds: ["n1"] });

      expect(JSON.stringify(result)).not.toContain("payload");
    });

    it("leaves the user's own document unnarrowed", async () => {
      const payload = { roots: [{ id: "n1", type: "embed", htmlContent: "<b>mine</b>" }] };
      executeToolCall.mockResolvedValue(JSON.stringify(payload));
      await registerWebMcpTools();

      expect(await invoke("batch_get", { nodeIds: ["n1"] })).toEqual(payload);
    });
  });

  it("does nothing when the page has no model context", async () => {
    Reflect.deleteProperty(navigator, "modelContext");
    Reflect.deleteProperty(document, "modelContext");

    expect(await registerWebMcpTools()).toEqual({ registered: [], withheld: [] });
  });

  describe("surface ownership", () => {
    // The tools cannot be unregistered, so leaving the editor route has to be
    // enforced at call time or an agent keeps editing a document nothing
    // renders.
    it("refuses every tool once the editor route has unmounted", async () => {
      await registerWebMcpTools();
      setSurfaceActive(false);

      for (const [name, args] of [
        ["get_variables", {}],
        ["batch_design", { operations: "I(document, {})" }],
      ] as const) {
        expect(await invoke(name, args), name).toEqual({
          isError: true,
          error: SURFACE_INACTIVE,
        });
      }
      expect(executeToolCall).not.toHaveBeenCalled();
    });

    it("answers again after the editor remounts", async () => {
      executeToolCall.mockResolvedValue(JSON.stringify({ ok: true }));
      await registerWebMcpTools();
      setSurfaceActive(false);
      setSurfaceActive(true);

      await expect(invoke("get_variables", {})).resolves.toEqual({ ok: true });
    });

    it("names the inactive-surface refusal", () => {
      expect(SURFACE_INACTIVE).toMatch(/not mounted/i);
    });
  });

  // Forking a shared canvas navigates /c/:shareId -> /app client-side: the
  // same tab, a remount, and a document that is now the user's to edit.
  it("publishes the mutating tools after a read-only canvas becomes editable", async () => {
    useSharedViewStore.setState({ isSharedView: true });
    expect((await registerWebMcpTools()).withheld).toEqual(MUTATING);

    useSharedViewStore.setState({ isSharedView: false });
    const afterFork = await registerWebMcpTools();

    expect(afterFork.withheld).toEqual([]);
    const names = (await getModelContext()!.getTools()).map((t) => t.name);
    for (const name of MUTATING) expect(names).toContain(name);
  });
});
