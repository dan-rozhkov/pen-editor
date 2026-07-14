// src/lib/designTokens/__tests__/tokenPath.test.ts
import { describe, it, expect } from "vitest";
import {
  nameToSegments,
  segmentsToAlias,
  setTokenAtPath,
  walkTokens,
} from "@/lib/designTokens/tokenPath";
import type { DtcgGroup, DtcgToken } from "@/lib/designTokens/dtcgTypes";

describe("tokenPath", () => {
  it("splits a slash name into trimmed non-empty segments", () => {
    expect(nameToSegments("brand/500")).toEqual(["brand", "500"]);
    expect(nameToSegments(" brand / 500 ")).toEqual(["brand", "500"]);
    expect(nameToSegments("solo")).toEqual(["solo"]);
    expect(nameToSegments("a//b/")).toEqual(["a", "b"]);
  });

  it("builds a dot-path alias", () => {
    expect(segmentsToAlias(["brand", "500"])).toBe("{brand.500}");
  });

  it("nests a token under its path and walks it back", () => {
    const root: DtcgGroup = {};
    const token: DtcgToken = { $type: "color", $value: "#fff" };
    setTokenAtPath(root, ["brand", "500"], token);
    expect((root.brand as DtcgGroup)["500"]).toBe(token);

    const seen: Array<[string[], unknown]> = [];
    walkTokens(root, (t, segs) => seen.push([segs, t.$value]));
    expect(seen).toEqual([[["brand", "500"], "#fff"]]);
  });

  it("does not treat group metadata as a token when walking", () => {
    const root: DtcgGroup = { $type: "color", brand: { $value: "#000" } as DtcgToken };
    const paths: string[][] = [];
    walkTokens(root, (_t, segs) => paths.push(segs));
    expect(paths).toEqual([["brand"]]);
  });
});
