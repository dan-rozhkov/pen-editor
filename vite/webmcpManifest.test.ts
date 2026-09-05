import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { webmcpManifest } from "./webmcpManifest";
import { buildWebMcpManifest } from "../src/lib/webmcp/manifest";

// Plugin hooks are invoked directly here rather than through a real Vite dev
// server — the middleware/emitFile shapes are small enough to fake, and this
// keeps the test hermetic and fast.

function callConfigureServer(base: string) {
  const plugin = webmcpManifest();
  const use = vi.fn();
  const configureServer = plugin.configureServer as (server: unknown) => void;
  configureServer({ middlewares: { use }, config: { base } });
  expect(use).toHaveBeenCalledTimes(1);
  return use.mock.calls[0][0] as (
    req: { url?: string },
    res: { setHeader: (name: string, value: string) => void; end: (body: string) => void },
    next: () => void
  ) => void;
}

describe("webmcpManifest plugin", () => {
  it("configureServer responds with the manifest JSON on the base-prefixed path", () => {
    const middleware = callConfigureServer("/");
    const setHeader = vi.fn();
    const end = vi.fn();
    const next = vi.fn();

    middleware({ url: "/webmcp.json" }, { setHeader, end }, next);

    expect(next).not.toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith("Content-Type", "application/json");
    expect(end).toHaveBeenCalledTimes(1);
    const body = end.mock.calls[0][0] as string;
    expect(JSON.parse(body)).toEqual(buildWebMcpManifest());
  });

  it("respects a non-root base when matching the request path", () => {
    const middleware = callConfigureServer("/pen-editor/");
    const setHeader = vi.fn();
    const end = vi.fn();
    const next = vi.fn();

    middleware({ url: "/pen-editor/webmcp.json" }, { setHeader, end }, next);
    expect(end).toHaveBeenCalledTimes(1);

    // The bare, un-prefixed path must NOT match once a base is configured.
    const next2 = vi.fn();
    middleware({ url: "/webmcp.json" }, { setHeader, end }, next2);
    expect(next2).toHaveBeenCalledTimes(1);
  });

  it("calls next() and does not respond for any other path", () => {
    const middleware = callConfigureServer("/");
    const setHeader = vi.fn();
    const end = vi.fn();
    const next = vi.fn();

    middleware({ url: "/index.html" }, { setHeader, end }, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
  });

  it("matches the path with a query string stripped", () => {
    const middleware = callConfigureServer("/");
    const setHeader = vi.fn();
    const end = vi.fn();
    const next = vi.fn();

    middleware({ url: "/webmcp.json?x=1" }, { setHeader, end }, next);

    expect(next).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("generateBundle emits webmcp.json as an asset containing the manifest", () => {
    const plugin = webmcpManifest();
    const emitFile = vi.fn();
    // Rollup types `generateBundle` as ObjectHook<...> | undefined, which does
    // not overlap the plain function shape this test calls — `tsc -b` rejects
    // the direct cast, so it goes through `unknown`.
    const generateBundle = plugin.generateBundle as unknown as (
      this: { emitFile: typeof emitFile }
    ) => void;

    generateBundle.call({ emitFile });

    expect(emitFile).toHaveBeenCalledTimes(1);
    const arg = emitFile.mock.calls[0][0] as {
      type: string;
      fileName: string;
      source: string;
    };
    expect(arg.type).toBe("asset");
    expect(arg.fileName).toBe("webmcp.json");
    expect(JSON.parse(arg.source)).toEqual(buildWebMcpManifest());
  });
});

describe("index.html WebMCP discovery tags", () => {
  const html = readFileSync(join(__dirname, "..", "index.html"), "utf-8");

  it("links to the webmcp.json manifest via %BASE_URL%", () => {
    expect(html).toMatch(
      /<link\s+rel="mcp-tools"\s+type="application\/json"\s+href="%BASE_URL%webmcp\.json"\s*\/>/
    );
  });

  it("carries a <meta name=\"webmcp\"> pointer naming the editor routes", () => {
    const match = html.match(/<meta\s+name="webmcp"\s+content="([^"]*)"/);
    expect(match).not.toBeNull();
    const content = match![1];
    expect(content).toMatch(/navigator\.modelContext/);
    expect(content).toMatch(/\/app/);
    expect(content).toMatch(/\/c\/:id/);
  });
});
