import { describe, expect, it } from "vitest";
import { getAllCustomFontRecords, putCustomFontRecord } from "@/utils/customFontDb";

// This file intentionally does NOT import "fake-indexeddb/auto" — happy-dom
// does not implement IndexedDB by default, so this exercises the graceful
// degradation path (e.g. private browsing / restricted environments) with no
// polyfill in place. Vitest isolates globals per test file, so the polyfill
// imported by customFontDb.test.ts doesn't leak in here.
describe("customFontDb without IndexedDB support", () => {
  it("indexedDB is unavailable in this environment (sanity check for the test itself)", () => {
    expect(typeof indexedDB).toBe("undefined");
  });

  it("getAllCustomFontRecords resolves to an empty array instead of throwing", async () => {
    await expect(getAllCustomFontRecords()).resolves.toEqual([]);
  });

  it("putCustomFontRecord rejects instead of crashing silently", async () => {
    await expect(
      putCustomFontRecord({ family: "X", fileName: "x.ttf", format: "ttf", bytes: new ArrayBuffer(4) }),
    ).rejects.toThrow();
  });
});
