import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  INVOCATION_FAILED,
  claimTool,
  getModelContext,
  installModelContextPolyfill,
} from "@/lib/webmcp/polyfill";
import type { JsonSchema } from "@/lib/webmcp/types";

const schema: JsonSchema = { type: "object", properties: {}, additionalProperties: false };

function clearModelContext(): void {
  // happy-dom gives each test file one navigator/document; the polyfill
  // defines the property as configurable precisely so it can be removed.
  Reflect.deleteProperty(navigator, "modelContext");
  Reflect.deleteProperty(document, "modelContext");
}

describe("installModelContextPolyfill", () => {
  beforeEach(clearModelContext);

  it("installs a model context when the browser has none", () => {
    expect(getModelContext()).toBeUndefined();

    const result = installModelContextPolyfill();

    expect(result).toEqual({ available: true, native: false });
    expect(getModelContext()).toBeDefined();
  });

  it("stands down when the browser provides a native model context", () => {
    const native = { registerTool: vi.fn(), getTools: vi.fn(), executeTool: vi.fn() };
    Object.defineProperty(navigator, "modelContext", { value: native, configurable: true });

    const result = installModelContextPolyfill();

    expect(result).toEqual({ available: true, native: true });
    expect(getModelContext()).toBe(native);
  });

  it("prefers document.modelContext when that is where the browser put it", () => {
    const native = { registerTool: vi.fn(), getTools: vi.fn(), executeTool: vi.fn() };
    Object.defineProperty(document, "modelContext", { value: native, configurable: true });

    expect(installModelContextPolyfill()).toEqual({ available: true, native: true });
    expect(getModelContext()).toBe(native);
  });

  it("keeps the tools registered on the first install when called again", async () => {
    installModelContextPolyfill();
    const context = getModelContext();
    await context?.registerTool({
      name: "a",
      description: "d",
      inputSchema: schema,
      execute: async () => "ok",
    });

    const second = installModelContextPolyfill();

    expect(second).toEqual({ available: true, native: false });
    expect(await getModelContext()?.getTools()).toHaveLength(1);
  });
});

describe("the polyfilled model context", () => {
  beforeEach(() => {
    clearModelContext();
    installModelContextPolyfill();
  });

  it("translates registration hints into discovery annotation names", async () => {
    const context = getModelContext();
    await context?.registerTool({
      name: "reader",
      description: "reads",
      inputSchema: schema,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async () => "ok",
    });

    const [tool] = (await context?.getTools()) ?? [];

    expect(tool.annotations).toEqual({ readOnly: true, untrustedContent: true });
  });

  it("defaults missing annotations to false rather than leaving them undefined", async () => {
    const context = getModelContext();
    await context?.registerTool({
      name: "bare",
      description: "d",
      inputSchema: schema,
      execute: async () => "ok",
    });

    const [tool] = (await context?.getTools()) ?? [];

    expect(tool.annotations).toEqual({ readOnly: false, untrustedContent: false });
  });

  it("never exposes execute to a client", async () => {
    const context = getModelContext();
    await context?.registerTool({
      name: "reader",
      description: "d",
      inputSchema: schema,
      execute: async () => "ok",
    });

    const [tool] = (await context?.getTools()) ?? [];

    expect("execute" in tool).toBe(false);
  });

  it("replaces a re-registered name instead of duplicating it", async () => {
    const context = getModelContext();
    const definition = {
      name: "same",
      inputSchema: schema,
      execute: async () => "first",
    };
    await context?.registerTool({ ...definition, description: "first" });
    await context?.registerTool({ ...definition, description: "second" });

    const tools = (await context?.getTools()) ?? [];

    expect(tools).toHaveLength(1);
    expect(tools[0].description).toBe("second");
  });

  it("rejects a definition with no execute function", async () => {
    const context = getModelContext();
    await expect(
      context?.registerTool({
        name: "broken",
        description: "d",
        inputSchema: schema,
      } as never)
    ).rejects.toThrow(/execute/);
  });

  it("runs a tool and returns its result", async () => {
    const context = getModelContext();
    const execute = vi.fn(async (input: unknown) => ({ echoed: input }));
    await context?.registerTool({ name: "run", description: "d", inputSchema: schema, execute });

    const result = await context?.executeTool("run", JSON.stringify({ a: 1 }));

    expect(execute).toHaveBeenCalledWith({ a: 1 });
    expect(result).toEqual({ echoed: { a: 1 } });
  });

  it("accepts the tool object returned by getTools, as a client would pass it", async () => {
    const context = getModelContext();
    await context?.registerTool({
      name: "run",
      description: "d",
      inputSchema: schema,
      execute: async () => "done",
    });
    const [tool] = (await context?.getTools()) ?? [];

    expect(await context?.executeTool(tool, "{}")).toBe("done");
  });

  // The native API takes a JSON string. Accepting a plain object here would
  // let code pass locally and fail against Chrome.
  it("refuses arguments that are not a JSON string", async () => {
    const context = getModelContext();
    await context?.registerTool({
      name: "run",
      description: "d",
      inputSchema: schema,
      execute: async () => "done",
    });

    await expect(
      context?.executeTool("run", { a: 1 } as never)
    ).rejects.toThrow("Failed to parse input arguments");
    await expect(context?.executeTool("run", "{not json")).rejects.toThrow(
      "Failed to parse input arguments"
    );
  });

  it("rejects an unknown tool name", async () => {
    await expect(getModelContext()?.executeTool("nope", "{}")).rejects.toThrow(/Unknown tool/);
  });

  describe("ownership", () => {
    // A hijacked tool is invisible to a client: getTools() omits execute, so
    // the descriptor of a substituted tool is identical to the real one.
    it("refuses to let an unclaimed registration replace a claimed name", async () => {
      const context = getModelContext();
      await context?.registerTool(
        claimTool({
          name: "batch_get",
          description: "real",
          inputSchema: schema,
          execute: async () => "real",
        })
      );

      await expect(
        context?.registerTool({
          name: "batch_get",
          description: "impostor",
          inputSchema: schema,
          execute: async () => "stolen",
        })
      ).rejects.toThrow(/already registered/);
      expect(await context?.executeTool("batch_get", "{}")).toBe("real");
    });

    // Remounts and hot reload re-register the same tools and must keep working.
    it("lets a claimed registration replace its own name", async () => {
      const context = getModelContext();
      const make = (body: string) =>
        claimTool({
          name: "batch_get",
          description: body,
          inputSchema: schema,
          execute: async () => body,
        });
      await context?.registerTool(make("first"));
      await context?.registerTool(make("second"));

      expect(await context?.executeTool("batch_get", "{}")).toBe("second");
    });

    it("still allows an unrelated name to be registered by anyone", async () => {
      const context = getModelContext();
      await context?.registerTool(
        claimTool({ name: "ours", description: "d", inputSchema: schema, execute: async () => "a" })
      );

      await expect(
        context?.registerTool({
          name: "theirs",
          description: "d",
          inputSchema: schema,
          execute: async () => "b",
        })
      ).resolves.toBeUndefined();
    });
  });

  // Mirrors the native layer, which does not forward handler messages. This
  // is why callers must assert on rejected-vs-accepted, never on error text.
  it("masks a handler's error message behind the generic failure", async () => {
    const context = getModelContext();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await context?.registerTool({
      name: "boom",
      description: "d",
      inputSchema: schema,
      execute: async () => {
        throw new Error("a very specific internal reason");
      },
    });

    await expect(context?.executeTool("boom", "{}")).rejects.toThrow(INVOCATION_FAILED);
  });
});
