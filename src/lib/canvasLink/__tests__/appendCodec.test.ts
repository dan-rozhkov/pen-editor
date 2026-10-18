import { describe, it, expect } from "vitest";
import { AppendDecoder, AppendEncoder } from "../appendCodec";

const ops = (s: string, extra: Record<string, unknown> = {}) => ({ operations: s, ...extra });

describe("append codec", () => {
  it("sends full first, then only the growth of one string field", () => {
    const enc = new AppendEncoder("t1", "batch_design");
    expect(enc.encode(ops("a=I("))).toMatchObject({ format: "full", seq: 0 });
    const m = enc.encode(ops("a=I(doc)"));
    expect(m).toMatchObject({ format: "append", field: "operations", offset: 4, append: "doc)", seq: 1 });
    expect(m).not.toHaveProperty("rest");
  });

  it("skips unchanged input and sends rest only when other fields changed", () => {
    const enc = new AppendEncoder("t1", "x");
    enc.encode(ops("ab", { n: 1 }));
    expect(enc.encode(ops("ab", { n: 1 }))).toBeNull();
    const m = enc.encode(ops("abc", { n: 2 }));
    expect(m).toMatchObject({ format: "append", append: "c", rest: { n: 2 } });
  });

  it("falls back to full when the string is rewritten or two fields grow", () => {
    const enc = new AppendEncoder("t1", "x");
    enc.encode({ a: "xx", b: "yy" });
    expect(enc.encode({ a: "zz", b: "yy" })).toMatchObject({ format: "full" });
    expect(enc.encode({ a: "zz1", b: "yy1" })).toMatchObject({ format: "full" });
  });


  it("round-trips a stream through the decoder", () => {
    const enc = new AppendEncoder("t1", "x");
    const dec = new AppendDecoder();
    let last: unknown;
    for (const input of [ops("a"), ops("ab", { name: "n" }), ops("abc", { name: "n" }), ops("abcd", { name: "m" })]) {
      const msg = enc.encode(input)!;
      const res = dec.apply(msg);
      expect(res.status).toBe("input");
      if (res.status === "input") last = res.input;
    }
    expect(last).toEqual(ops("abcd", { name: "m" }));
  });

  it("asks for resync on an offset mismatch, ignores appends, recovers on full", () => {
    const enc = new AppendEncoder("t1", "x");
    const dec = new AppendDecoder();
    dec.apply(enc.encode(ops("ab"))!);
    enc.encode(ops("abc")); // lost on the wire
    const second = enc.encode(ops("abcd"))!;
    expect(dec.apply(second)).toEqual({ status: "resync" });
    expect(dec.apply(enc.encode(ops("abcde"))!)).toEqual({ status: "ignored" });
    enc.forceFull();
    const full = enc.encode(ops("abcdef"))!;
    expect(full.format).toBe("full");
    expect(dec.apply(full)).toEqual({ status: "input", input: ops("abcdef") });
    expect(dec.apply(enc.encode(ops("abcdefg"))!)).toEqual({ status: "input", input: ops("abcdefg") });
  });

  it("rejects a seq gap and a non-full first message", () => {
    const enc = new AppendEncoder("t1", "x");
    enc.encode(ops("a"));
    const late = enc.encode(ops("ab"))!;
    expect(new AppendDecoder().apply(late)).toEqual({ status: "resync" });
    const dec = new AppendDecoder();
    dec.apply(enc.encode(ops("abc"))!); // append with seq 2 as first message -> rejected
    expect(dec.apply(enc.encode(ops("abcd"))!)).toEqual({ status: "ignored" });
  });

  it("re-emits resync at most once per 250 ms while awaiting full", () => {
    let t = 1000;
    const dec = new AppendDecoder(() => t);
    const enc = new AppendEncoder("t1", "x");
    enc.encode(ops("a"));
    expect(dec.apply(enc.encode(ops("ab"))!)).toEqual({ status: "resync" });
    t += 100;
    expect(dec.apply(enc.encode(ops("abc"))!)).toEqual({ status: "ignored" });
    t += 200;
    expect(dec.apply(enc.encode(ops("abcd"))!)).toEqual({ status: "resync" });
  });

  it("survives caller mutation, key order and nested values", () => {
    const enc = new AppendEncoder("t1", "x");
    const input: Record<string, unknown> = { a: "x", n: { k: 1 } };
    enc.encode(input);
    input.a = "xy";
    expect(enc.encode(input)).toMatchObject({ format: "append", append: "y" });
    expect(enc.encode({ n: { k: 1 }, a: "xy" })).toBeNull();
    expect(enc.encode({ n: { k: 2 }, a: "xy" })).toMatchObject({ format: "full" });
  });
});
