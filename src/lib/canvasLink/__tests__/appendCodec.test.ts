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

  describe("path-addressed patch", () => {
    const edit = (nodeId: string, edits: Array<{ oldString: string; newString: string }>) => ({ nodeId, edits });

    it("emits a patch (not full) for growth nested in edits[i].newString", () => {
      const enc = new AppendEncoder("t1", "edit_embed_html");
      const big = "x".repeat(200);
      enc.encode(edit("n1", [{ oldString: "<p>", newString: big }]));
      const m = enc.encode(edit("n1", [{ oldString: "<p>", newString: big + "yy" }]));
      expect(m).toMatchObject({
        format: "patch",
        ops: [{ path: ["edits", 0, "newString"], op: "append", offset: 200, text: "yy" }],
      });
    });

    it("round-trips a simulated edit_embed_html partial-input stream", () => {
      const enc = new AppendEncoder("t1", "edit_embed_html");
      const dec = new AppendDecoder();
      const html = "<div class=\"a\">hello world, this is a longer replacement body</div>".repeat(3);
      const steps: unknown[] = [{}, { nodeId: "n" }, { nodeId: "n", edits: [] }, { nodeId: "n", edits: [{}] }];
      for (let i = 1; i <= html.length; i += 7) {
        steps.push({ nodeId: "n", edits: [{ oldString: "<div>old</div>", newString: html.slice(0, i) }] });
      }
      steps.push({ nodeId: "n", edits: [{ oldString: "<div>old</div>", newString: html }, { oldString: "a" }] });
      for (let i = 1; i <= html.length; i += 11) {
        steps.push({
          nodeId: "n",
          edits: [
            { oldString: "<div>old</div>", newString: html },
            { oldString: "a", newString: html.slice(0, i) },
          ],
        });
      }
      const formats = new Set<string>();
      const decoded: Array<{ res: unknown; snapshot: unknown }> = [];
      for (const input of steps) {
        const snapshot = JSON.parse(JSON.stringify(input));
        const msg = enc.encode(input as Record<string, unknown>);
        if (msg === null) continue;
        formats.add(msg.format);
        const res = dec.apply(msg);
        decoded.push({ res, snapshot });
      }
      expect(decoded.map((d) => d.res)).toEqual(decoded.map((d) => ({ status: "input", input: d.snapshot })));
      expect(formats.has("patch")).toBe(true);
    });

    it("sends a new array element as a set op", () => {
      const enc = new AppendEncoder("t1", "x");
      const dec = new AppendDecoder();
      const first = edit("n1", [{ oldString: "a".repeat(80), newString: "b".repeat(80) }]);
      dec.apply(enc.encode(first)!);
      const next = edit("n1", [first.edits[0], { oldString: "c", newString: "d" }]);
      const m = enc.encode(next)!;
      expect(m).toMatchObject({ format: "patch", ops: [{ path: ["edits", 1], op: "set", value: { oldString: "c", newString: "d" } }] });
      expect(dec.apply(m)).toEqual({ status: "input", input: next });
    });

    it("falls back to full for removal, non-prefix change, type change and shorter arrays", () => {
      const pad = "p".repeat(100);
      const base = () => ({ a: pad, list: [pad, pad], o: { k: pad } });
      const cases: Array<Record<string, unknown>> = [
        { a: pad, list: [pad, pad] }, // removed key
        { ...base(), o: { k: "q" + pad } }, // non-prefix nested change
        { ...base(), list: pad }, // type change
        { ...base(), list: [pad] }, // shrinking array
      ];
      for (const input of cases) {
        const enc = new AppendEncoder("t1", "x");
        enc.encode(base());
        expect(enc.encode(input)).toMatchObject({ format: "full" });
      }
    });

    it("falls back to full when the ops are not smaller than the input", () => {
      const enc = new AppendEncoder("t1", "x");
      enc.encode({ e: [{ s: "a" }] });
      expect(enc.encode({ e: [{ s: "ab" }] })).toMatchObject({ format: "full" });
    });

    it("returns null when nested content is unchanged", () => {
      const enc = new AppendEncoder("t1", "x");
      const input = edit("n", [{ oldString: "a", newString: "b" }]);
      enc.encode(input);
      expect(enc.encode(structuredClone(input))).toBeNull();
    });

    it("asks for resync on an offset mismatch or a missing path, then recovers on full", () => {
      const dec = new AppendDecoder();
      const head = { kind: "stream" as const, toolCallId: "t1", toolName: "x" };
      dec.apply({ ...head, seq: 0, format: "full", input: { edits: [{ s: "abc" }] } });
      const bad = dec.apply({
        ...head,
        seq: 1,
        format: "patch",
        ops: [{ path: ["edits", 0, "s"], op: "append", offset: 2, text: "z" }],
      });
      expect(bad).toEqual({ status: "resync" });
      const dec2 = new AppendDecoder();
      dec2.apply({ ...head, seq: 0, format: "full", input: { edits: [] } });
      expect(
        dec2.apply({ ...head, seq: 1, format: "patch", ops: [{ path: ["edits", 3, "s"], op: "append", offset: 0, text: "z" }] }),
      ).toEqual({ status: "resync" });
      expect(dec.apply({ ...head, seq: 5, format: "full", input: { ok: 1 } })).toEqual({ status: "input", input: { ok: 1 } });
    });

    it("does not mutate the previous decoded value (copy-on-write)", () => {
      const dec = new AppendDecoder();
      const head = { kind: "stream" as const, toolCallId: "t1", toolName: "x" };
      const r0 = dec.apply({ ...head, seq: 0, format: "full", input: { nodeId: "n", edits: [{ s: "ab" }] } });
      const r1 = dec.apply({ ...head, seq: 1, format: "patch", ops: [{ path: ["edits", 0, "s"], op: "append", offset: 2, text: "c" }] });
      expect(r0).toEqual({ status: "input", input: { nodeId: "n", edits: [{ s: "ab" }] } });
      expect(r1).toEqual({ status: "input", input: { nodeId: "n", edits: [{ s: "abc" }] } });
    });

    it("still decodes an old-format top-level append frame", () => {
      const dec = new AppendDecoder();
      const head = { kind: "stream" as const, toolCallId: "t1", toolName: "x" };
      dec.apply({ ...head, seq: 0, format: "full", input: { operations: "a=I(", n: 1 } });
      expect(dec.apply({ ...head, seq: 1, format: "append", field: "operations", offset: 4, append: "doc)" })).toEqual({
        status: "input",
        input: { operations: "a=I(doc)", n: 1 },
      });
    });
  });
});
