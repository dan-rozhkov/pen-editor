import { describe, expect, it } from "vitest";
import { applyDocEdits } from "../applyDocEdits";

describe("applyDocEdits", () => {
  it("applies edits in order, each seeing the previous result", () => {
    const r = applyDocEdits("a b", [
      { oldString: "a", newString: "x" },
      { oldString: "x b", newString: "done" },
    ]);
    expect(r).toEqual({ ok: true, markdown: "done", applied: 2 });
  });

  it("rejects a missing oldString with the edit index", () => {
    const r = applyDocEdits("abc", [{ oldString: "a", newString: "b" }, { oldString: "zzz", newString: "q" }]);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain("Edit 1");
    expect((r as { error: string }).error).toContain("0 matches");
  });

  it("rejects an ambiguous oldString and states the count", () => {
    const r = applyDocEdits("x x x", [{ oldString: "x", newString: "y" }]);
    expect((r as { error: string }).error).toContain("3 times");
  });

  it("replaceAll replaces every occurrence", () => {
    expect(applyDocEdits("x x x", [{ oldString: "x", newString: "y", replaceAll: true }])).toMatchObject({ ok: true, markdown: "y y y" });
  });

  it("keeps $ patterns in newString literal", () => {
    expect(applyDocEdits("price", [{ oldString: "price", newString: "$& $1" }])).toMatchObject({ markdown: "$& $1" });
    expect(applyDocEdits("a a", [{ oldString: "a", newString: "$&", replaceAll: true }])).toMatchObject({ markdown: "$& $&" });
  });

  it("rejects an empty oldString", () => {
    expect(applyDocEdits("abc", [{ oldString: "", newString: "x" }])).toMatchObject({ ok: false });
  });

  it("an empty edit list applies zero edits", () => {
    expect(applyDocEdits("abc", [])).toEqual({ ok: true, markdown: "abc", applied: 0 });
  });
});
