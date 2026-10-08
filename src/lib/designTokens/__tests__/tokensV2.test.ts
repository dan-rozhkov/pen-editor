import { describe, it, expect } from "vitest";
import type { Variable, VariableCollection } from "@/types/variable";
import { buildVariableIndex, finalizeVariables, resolveVariable } from "@/lib/variables";
import { toDtcg } from "../toDtcg";
import { fromDtcg } from "../fromDtcg";
import { toCss } from "../toCss";
import { toTailwindTheme } from "../toTailwindTheme";
import type { DtcgDocument } from "../dtcgTypes";
import { readPenExt, type DtcgToken } from "../dtcgTypes";

const empty = { fillStyles: [], effectStyles: [], textStyles: [] };
const brand: VariableCollection = {
  id: "brand", name: "Brand",
  modes: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
  defaultModeId: "a",
};

describe("toDtcg v2", () => {
  it("writes collection, modes, aliases, description, scopes and deprecation", () => {
    const variables = finalizeVariables(
      [
        { id: "base", name: "base", type: "color", collectionId: "brand", valuesByMode: { a: "#111111", b: "#222222", c: "#333333" }, value: "" },
        {
          id: "link", name: "ui/link", type: "color", collectionId: "brand",
          valuesByMode: { a: { alias: "base" }, b: "#abcdef" }, value: "",
          description: "Links", scopes: ["text"], deprecated: { since: "2", replacedBy: "base", note: "use base" },
        },
      ],
      [brand],
    );
    const { document } = toDtcg({ variables, collections: [brand], ...empty });
    const link = (document.ui as DtcgDocument).link as DtcgToken;
    expect(link.$value).toBe("{base}");
    expect(link.$description).toBe("Links");
    const ext = readPenExt(link);
    expect(ext?.collection).toEqual(brand);
    expect(ext?.modes).toEqual({ a: "{base}", b: "#abcdef" });
    expect(ext?.scopes).toEqual(["text"]);
    expect(ext?.deprecated).toEqual({ since: "2", note: "use base", replacedBy: "{base}" });
  });

  it("Theme-only document keeps writing themes.dark and no collection/modes", () => {
    const variables = finalizeVariables(
      [{ id: "c", name: "c", type: "color", value: "#fff", themeValues: { light: "#fff", dark: "#000" } }],
      undefined,
    );
    const ext = readPenExt(toDtcg({ variables, ...empty }).document.c as DtcgToken);
    expect(ext).toEqual({ id: "c", source: "variable", themes: { dark: "#000" } });
  });

  it("prefixes the collection name on a cross-collection path collision, with a warning", () => {
    const variables = finalizeVariables(
      [
        { id: "x1", name: "same", type: "color", collectionId: "theme", valuesByMode: { light: "#fff", dark: "#000" }, value: "" },
        { id: "x2", name: "same", type: "color", collectionId: "brand", valuesByMode: { a: "#111111" }, value: "" },
      ],
      [brand],
    );
    const { document, warnings } = toDtcg({ variables, collections: [brand], ...empty });
    expect((document.Brand as DtcgDocument).same).toBeDefined();
    expect(warnings.some((w) => /several collections/.test(w))).toBe(true);
    const { result } = fromDtcg(document);
    expect(result.variables.find((v) => v.id === "x2")?.name).toBe("same");
  });
});

describe("fromDtcg v2", () => {
  it("imports a legacy file (themes.dark) into the Theme collection", () => {
    const { result } = fromDtcg({
      brand: {
        $type: "color", $value: "#fff",
        $extensions: { "com.peneditor": { id: "v1", source: "variable", themes: { dark: "#000" } } },
      },
    });
    expect(result.collections.map((c) => c.id)).toEqual(["theme"]);
    expect(result.variables[0].valuesByMode).toEqual({ light: "#fff", dark: "#000" });
    expect(result.variables[0].themeValues).toEqual({ light: "#fff", dark: "#000" });
  });

  it("imports a foreign file with aliases into a 'Tokens' collection", () => {
    const { result, warnings } = fromDtcg({
      base: { $type: "color", $value: "#123456" },
      alias: { $type: "color", $value: "{base}" },
    });
    expect(warnings).toEqual([]);
    expect(result.collections).toEqual([
      { id: "tokens", name: "Tokens", modes: [{ id: "default", name: "Default" }], defaultModeId: "default" },
    ]);
    const base = result.variables.find((v) => v.name === "base") as Variable;
    const alias = result.variables.find((v) => v.name === "alias") as Variable;
    expect(alias.valuesByMode).toEqual({ default: { alias: base.id } });
    expect(alias.value).toBe("#123456");
  });

  it("keeps a default and warns on an alias to an unknown path", () => {
    const { result, warnings } = fromDtcg({ a: { $type: "color", $value: "{nope}" } });
    expect(result.variables[0].valuesByMode).toEqual({ default: "#000000" });
    expect(warnings.some((w) => /unknown alias \{nope\}/.test(w))).toBe(true);
  });

  it("rejects an alias cycle and an alias of a different type", () => {
    const { result, warnings } = fromDtcg({
      a: { $type: "color", $value: "{b}" },
      b: { $type: "color", $value: "{a}" },
      n: { $type: "number", $value: "{a}" },
    });
    expect(warnings.filter((w) => /cycle/.test(w))).toHaveLength(1);
    expect(warnings.some((w) => /different type/.test(w))).toBe(true);
    const index = buildVariableIndex(result.variables, result.collections);
    for (const v of result.variables) expect(resolveVariable(index, v.id, {}).ok).toBe(true);
  });

  it("round trips 3 modes, aliases and deprecation", () => {
    const variables = finalizeVariables(
      [
        { id: "base", name: "base", type: "color", collectionId: "brand", valuesByMode: { a: "#111111", b: "#222222", c: "#333333" }, value: "" },
        {
          id: "link", name: "link", type: "color", collectionId: "brand",
          valuesByMode: { a: { alias: "base" }, c: "#abcdef" }, value: "", deprecated: { replacedBy: "base" },
        },
      ],
      [brand],
    );
    const { result } = fromDtcg(toDtcg({ variables, collections: [brand], ...empty }).document);
    expect(result.collections).toEqual([brand]);
    expect(result.variables.find((v) => v.id === "link")?.valuesByMode).toEqual({ a: { alias: "base" }, c: "#abcdef" });
    expect(result.variables.find((v) => v.id === "link")?.deprecated).toEqual({ replacedBy: "base" });
  });

  it("binds a fill style to an alias variable with its default-mode color", () => {
    const { result } = fromDtcg({
      base: { $type: "color", $value: "#123456" },
      fill: { p: { $type: "color", $value: "{base}" } },
    });
    const paint = result.fillStyles[0].paint;
    expect(paint.type === "solid" && paint.color).toBe("#123456");
  });
});

describe("CSS export safety", () => {
  const variables = finalizeVariables(
    [
      { id: "s", name: "Font / Body  Text", type: "string", collectionId: "brand", valuesByMode: { a: "a;b", b: "x}y" }, value: "" },
      { id: "e", name: "😀", type: "color", collectionId: "brand", valuesByMode: { a: "#fff" }, value: "" },
    ],
    [brand],
  );
  it("makes identifiers safe and quotes unsafe values", () => {
    const { css } = toCss({ variables, collections: [brand] });
    expect(css).toContain('--font-body-text: "a;b";');
    expect(css).toContain('--var-e: #fff;');
    expect(css).toContain('[data-brand="b"] {\n  --font-body-text: "x}y";');
    expect(css).not.toContain('[data-brand="c"]');
  });
  it("tailwind puts a string token in plain :root", () => {
    const { css } = toTailwindTheme({ variables, collections: [brand] });
    expect(css).toContain("--color-var-e: #fff;");
    expect(css).not.toContain("@custom-variant");
  });
});
