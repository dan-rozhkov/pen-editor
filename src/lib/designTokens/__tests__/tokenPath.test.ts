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
    expect(setTokenAtPath(root, ["brand", "500"], token)).toBe(true);
    expect((root.brand as DtcgGroup)["500"]).toBe(token);

    const seen: Array<[string[], unknown]> = [];
    walkTokens(root, (t, segs) => seen.push([segs, t.$value]));
    expect(seen).toEqual([[["brand", "500"], "#fff"]]);
  });

  it("returns false and overwrites when two paths collide on the same slot", () => {
    const root: DtcgGroup = {};
    const first: DtcgToken = { $type: "color", $value: "#111" };
    const second: DtcgToken = { $type: "color", $value: "#222" };
    expect(setTokenAtPath(root, ["fill", "primary"], first)).toBe(true);
    expect(setTokenAtPath(root, ["fill", "primary"], second)).toBe(false);
    expect((root.fill as DtcgGroup).primary).toBe(second); // last-writer-wins
  });

  it("returns false when an intermediate segment was already a token", () => {
    const root: DtcgGroup = {};
    const varToken: DtcgToken = { $type: "color", $value: "#333" };
    const styleToken: DtcgToken = { $type: "color", $value: "#444" };
    // A variable named "fill" occupies the "fill" slot as a token...
    expect(setTokenAtPath(root, ["fill"], varToken)).toBe(true);
    // ...then a fill style tries to descend through "fill" as a group.
    expect(setTokenAtPath(root, ["fill", "primary"], styleToken)).toBe(false);
    // The write still happens (last-writer-wins): "fill" becomes a group again.
    expect((root.fill as DtcgGroup).primary).toBe(styleToken);
  });

  it("does not treat group metadata as a token when walking", () => {
    const root: DtcgGroup = { $type: "color", brand: { $value: "#000" } as DtcgToken };
    const paths: string[][] = [];
    walkTokens(root, (_t, segs) => paths.push(segs));
    expect(paths).toEqual([["brand"]]);
  });
});
