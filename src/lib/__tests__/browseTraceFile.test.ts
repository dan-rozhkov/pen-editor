import { describe, expect, it, vi } from "vitest";
import { sampleTrace, sampleTraceJson } from "@/components/trace/__fixtures__/sampleTrace";
import { exportBrowseTrace, readBrowseTraceFile, traceFileName } from "../browseTraceFile";

const png = new Uint8Array([137, 80, 78, 71]);
const answer = (type: string, ok = true) => ({ ok, blob: async () => new Blob([png], { type }) }) as unknown as Response;
const exported = async (trace: typeof sampleTrace, fetchImpl: typeof fetch) => JSON.parse(await (await exportBrowseTrace(trace, fetchImpl)).blob.text()) as typeof sampleTrace;
const remote = { ...sampleTrace, frames: sampleTrace.frames.map((f, i) => ({ ...f, src: `https://cdn.test/f${i}.png` })) };

describe("exportBrowseTrace", () => {
  it("leaves data URLs alone and never fetches them", async () => {
    const fetchImpl = vi.fn();
    const out = await exported(sampleTrace, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out.frames.map((f) => f.src)).toEqual(sampleTrace.frames.map((f) => f.src));
  });

  it("inlines fetched images as data URLs", async () => {
    const out = await exported(remote, (async () => answer("image/png")) as unknown as typeof fetch);
    expect(out.frames.every((f) => f.src.startsWith("data:image/png;base64,"))).toBe(true);
    expect(out.id).toBe(sampleTrace.id);
  });

  it.each([
    ["a failed fetch", (async () => { throw new Error("offline"); }) as unknown as typeof fetch],
    ["an error status", (async () => answer("image/png", false)) as unknown as typeof fetch],
    ["a type that is not an image", (async () => answer("text/html")) as unknown as typeof fetch],
    ["an svg", (async () => answer("image/svg+xml")) as unknown as typeof fetch],
  ])("keeps the address of a frame after %s", async (_name, fetchImpl) => {
    const out = await exported(remote, fetchImpl);
    expect(out.frames.map((f) => f.src)).toEqual(remote.frames.map((f) => f.src));
  });

  it("counts the frames that stay links", async () => {
    const fails = (async () => { throw new Error("cors"); }) as unknown as typeof fetch;
    expect((await exportBrowseTrace(remote, fails)).notInlined).toBe(remote.frames.length);
    expect((await exportBrowseTrace(remote, (async () => answer("image/png")) as unknown as typeof fetch)).notInlined).toBe(0);
    expect((await exportBrowseTrace(sampleTrace, fails)).notInlined).toBe(0);
  });

  it("names the file after the trace", () => expect(traceFileName(sampleTrace)).toBe("trace-sample-trace-1.json"));
});

describe("readBrowseTraceFile", () => {
  const file = (text: string) => new File([text], "t.json", { type: "application/json" });

  it("round-trips an exported trace", async () => {
    const { blob } = await exportBrowseTrace(remote, (async () => answer("image/webp")) as unknown as typeof fetch);
    const result = await readBrowseTraceFile(blob);
    expect(result).toMatchObject({ ok: true, trace: { id: "sample-trace-1" } });
  });

  it("parses a plain trace file", async () => {
    expect(await readBrowseTraceFile(file(JSON.stringify(sampleTraceJson())))).toMatchObject({ ok: true });
  });

  it.each([
    ["not JSON", "{oops", /not valid JSON/],
    ["not a trace", JSON.stringify({ hello: 1 }), /format/],
  ])("reports %s", async (_name, text, message) => {
    const result = await readBrowseTraceFile(file(text));
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(result.ok ? "" : result.message).toMatch(message);
  });
});
