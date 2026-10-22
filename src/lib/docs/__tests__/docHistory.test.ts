import { describe, expect, it } from "vitest";
import { EMPTY_DOC_HISTORY, canStep, goBackDoc, goForwardDoc, pushDoc } from "@/lib/docs/docHistory";

const all = () => true;

describe("docHistory", () => {
  it("push records the current id and clears forward", () => {
    const h = pushDoc({ back: [], forward: ["z"] }, "a", "b");
    expect(h).toEqual({ back: ["a"], forward: [] });
  });
  it("selecting the same id or having no current id is a no-op", () => {
    expect(pushDoc(EMPTY_DOC_HISTORY, "a", "a")).toBe(EMPTY_DOC_HISTORY);
    expect(pushDoc(EMPTY_DOC_HISTORY, null, "a")).toBe(EMPTY_DOC_HISTORY);
  });
  it("back then forward round-trips", () => {
    let h = pushDoc(EMPTY_DOC_HISTORY, "a", "b");
    h = pushDoc(h, "b", "c");
    const back = goBackDoc(h, "c", all)!;
    expect(back.target).toBe("b");
    expect(back.history).toEqual({ back: ["a"], forward: ["c"] });
    const fwd = goForwardDoc(back.history, "b", all)!;
    expect(fwd.target).toBe("c");
    expect(fwd.history).toEqual({ back: ["a", "b"], forward: [] });
  });
  it("skips and drops deleted documents", () => {
    const h = { back: ["a", "gone", "b"], forward: [] };
    const exists = (id: string) => id !== "gone";
    const s1 = goBackDoc(h, "c", exists)!;
    expect(s1.target).toBe("b");
    const s2 = goBackDoc(s1.history, "b", exists)!;
    expect(s2.target).toBe("a");
    expect(s2.history.back).toEqual([]);
  });
  it("returns null when nothing is reachable", () => {
    expect(goBackDoc(EMPTY_DOC_HISTORY, "a", all)).toBeNull();
    expect(goForwardDoc({ back: [], forward: ["gone"] }, "a", (id) => id !== "gone")).toBeNull();
    expect(canStep(["gone", "a"], "a", (id) => id !== "gone")).toBe(false);
    expect(canStep(["x"], "a", all)).toBe(true);
  });
});
