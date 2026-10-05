import { describe, expect, it, vi } from "vitest";
import { buildLoaderSource, embedLoader, embedRenderBuiltUrl, EMBED_LOADER_FILE } from "./embedLoader";

const bundle = {
  "assets/embed-AAA.js": {
    type: "chunk" as const,
    fileName: "assets/embed-AAA.js",
    isEntry: true,
    facadeModuleId: "/repo/embed.html",
    imports: ["assets/shared-BBB.js"],
    viteMetadata: { importedCss: new Set(["assets/own-CCC.css"]) },
  },
  "assets/shared-BBB.js": {
    type: "chunk" as const,
    fileName: "assets/shared-BBB.js",
    imports: [],
    viteMetadata: { importedCss: new Set(["assets/shared-DDD.css"]) },
  },
  "assets/main-EEE.js": {
    type: "chunk" as const,
    fileName: "assets/main-EEE.js",
    isEntry: true,
    facadeModuleId: "/repo/index.html",
    viteMetadata: { importedCss: new Set(["assets/main-FFF.css"]) },
  },
};

describe("embed loader plugin", () => {
  it("references the hashed embed entry and its CSS closure by loader-relative URL", () => {
    const source = buildLoaderSource(bundle);
    expect(source).toContain('import(new URL("assets/embed-AAA.js", base).href)');
    expect(source).toContain('"assets/own-CCC.css","assets/shared-DDD.css"');
    expect(source).toContain('link.crossOrigin = "anonymous"');
    expect(source).toContain('rel = "modulepreload"');
    expect(source).toContain('["assets/shared-BBB.js"]');
    expect(source).not.toContain("main-EEE");
    expect(source).not.toContain("main-FFF");
    expect(source).toContain('new URL("../", import.meta.url)');
  });

  it("fails the build when there is no embed entry", () => {
    expect(() => buildLoaderSource({})).toThrow(/no entry chunk/);
  });

  it("emits a fixed-name, non-hashed asset", () => {
    const emitFile = vi.fn();
    const generateBundle = embedLoader().generateBundle as unknown as (
      this: { emitFile: typeof emitFile },
      options: unknown,
      b: unknown,
    ) => void;
    generateBundle.call({ emitFile }, {}, bundle);
    expect(emitFile).toHaveBeenCalledWith(
      expect.objectContaining({ type: "asset", fileName: EMBED_LOADER_FILE }),
    );
    expect(EMBED_LOADER_FILE).toBe("embed/loader.js");
  });
});

describe("embedRenderBuiltUrl", () => {
  it("prefers the loader-published base and falls back to base + file", () => {
    const out = embedRenderBuiltUrl("/")("assets/x.js", { hostType: "js" });
    expect(out).toEqual({ runtime: expect.stringContaining('globalThis.__SIDEFORM_ASSET_BASE__') });
    expect(out?.runtime).toContain(':"/assets/x.js")');
  });

  it.each(["./", "", "https://cdn.example/"])("keeps Vite's default for base %j", (base) => {
    expect(embedRenderBuiltUrl(base)("assets/x.js", { hostType: "js" })).toBeUndefined();
  });

  it("leaves css/html hosts alone", () => {
    expect(embedRenderBuiltUrl("/")("assets/x.png", { hostType: "css" })).toBeUndefined();
  });
});
