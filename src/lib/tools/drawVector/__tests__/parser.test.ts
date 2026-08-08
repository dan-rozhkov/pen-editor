import { describe, expect, it } from "vitest";
import { buildVectorReplayFrames, parseVectorCommands } from "../parser";

const VALID = [
  "M(10, 20)",
  "L(50, 20)",
  "C(60, 20, 80, 40, 50, 80)",
  "CLOSE()",
  'FILL("#ff000080")',
  'STROKE("#112233", 2)',
  "END()",
].join("\n");

describe("parseVectorCommands", () => {
  it("reduces a valid final script to anchors, geometry, bounds and paints", () => {
    const result = parseVectorCommands(VALID, "final");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.points).toHaveLength(3);
    expect(result.draft.points[1].handleOut).toEqual({ x: 60, y: 20 });
    expect(result.draft.points[2].handleIn).toEqual({ x: 80, y: 40 });
    expect(result.draft.closed).toBe(true);
    expect(result.draft.geometry).toMatch(/^M10,20 L50,20 C/);
    expect(result.draft.bounds).toEqual(expect.objectContaining({ x: 10, y: 20 }));
    expect(result.draft.fill).toBe("#ff000080");
    expect(result.draft.stroke).toEqual({ color: "#112233", width: 2 });
    expect(result.draft.ended).toBe(true);
  });

  it("ignores only the unterminated final line in preview mode", () => {
    const result = parseVectorCommands("M(1, 2)\nL(3,", "preview");
    expect(result.ok && result.draft.points).toHaveLength(1);
  });

  it("consumes an unterminated END tail in final mode", () => {
    expect(parseVectorCommands("M(1,2)\nL(3,4)\nEND()", "final").ok).toBe(true);
  });

  it("accepts token whitespace and preserves color case", () => {
    const result = parseVectorCommands(' M ( -1 , 2 ) \n L ( 3 , 4 ) \n STROKE ( "#AaBbCcDD" , 0.5 ) \n END ( ) ', "final");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.stroke).toEqual({ color: "#AaBbCcDD", width: 0.5 });
  });

  it.each([
    ["command before M", "L(1,2)\nEND()", 1],
    ["duplicate M", "M(0,0)\nM(1,1)\nEND()", 2],
    ["too few open anchors", "M(0,0)\nEND()", 2],
    ["too few closed anchors", "M(0,0)\nL(1,1)\nCLOSE()\nEND()", 4],
    ["fill before close", 'M(0,0)\nL(1,1)\nFILL("#ffffff")\nEND()', 3],
    ["command after END", "M(0,0)\nL(1,1)\nEND()\nL(2,2)", 4],
    ["missing END", "M(0,0)\nL(1,1)", 2],
    ["unknown command", "M(0,0)\nL(1,1)\nWAT()\nEND()", 3],
    ["bad arity", "M(0)\nL(1,1)\nEND()", 1],
    ["NaN", "M(NaN,0)\nL(1,1)\nEND()", 1],
    ["Infinity", "M(Infinity,0)\nL(1,1)\nEND()", 1],
    ["coordinate too large", "M(1000001,0)\nL(1,1)\nEND()", 1],
    ["bad color", 'M(0,0)\nL(1,1)\nSTROKE("red",1)\nEND()', 3],
    ["zero width", 'M(0,0)\nL(1,1)\nSTROKE("#ffffff",0)\nEND()', 3],
    ["negative width", 'M(0,0)\nL(1,1)\nSTROKE("#ffffff",-1)\nEND()', 3],
    ["width too large", 'M(0,0)\nL(1,1)\nSTROKE("#ffffff",101)\nEND()', 3],
    ["duplicate close", "M(0,0)\nL(1,0)\nL(1,1)\nCLOSE()\nCLOSE()\nEND()", 5],
    ["duplicate fill", 'M(0,0)\nL(1,0)\nL(1,1)\nCLOSE()\nFILL("#ffffff")\nFILL("#000000")\nEND()', 6],
    ["duplicate stroke", 'M(0,0)\nL(1,1)\nSTROKE("#ffffff",1)\nSTROKE("#000000",2)\nEND()', 4],
    ["geometry after close", "M(0,0)\nL(1,0)\nL(1,1)\nCLOSE()\nL(2,2)\nEND()", 5],
    ["general SVG", "M 0 0 L 1 1\nEND()", 1],
    ["comment", "M(0,0)\n// L(1,1)\nEND()", 2],
    ["JSON5", "{ commands: ['M(0,0)'] }", 1],
  ])("rejects %s", (_name, source, line) => {
    const result = parseVectorCommands(source, "final");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.line).toBe(line);
  });

  it("rejects more than 512 anchors", () => {
    const source = ["M(0,0)", ...Array.from({ length: 512 }, (_, i) => `L(${i},1)`), "END()"].join("\n");
    expect(parseVectorCommands(source, "final").ok).toBe(false);
  });

  it("rejects more than 32,768 characters", () => {
    const result = parseVectorCommands(" ".repeat(32_769), "final");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.line).toBe(1);
  });

  it("rejects complete invalid lines in preview mode", () => {
    expect(parseVectorCommands("M(0,0)\nNOPE()\n", "preview").ok).toBe(false);
  });
});

describe("buildVectorReplayFrames", () => {
  it("returns an ordered frame for each visual command but not END", () => {
    const frames = buildVectorReplayFrames(VALID);
    expect(frames).toHaveLength(6);
    expect(frames.map((frame) => ({ points: frame.points.length, closed: frame.closed, fill: frame.fill, stroke: frame.stroke }))).toEqual([
      { points: 1, closed: false, fill: undefined, stroke: undefined },
      { points: 2, closed: false, fill: undefined, stroke: undefined },
      { points: 3, closed: false, fill: undefined, stroke: undefined },
      { points: 3, closed: true, fill: undefined, stroke: undefined },
      { points: 3, closed: true, fill: "#ff000080", stroke: undefined },
      { points: 3, closed: true, fill: "#ff000080", stroke: { color: "#112233", width: 2 } },
    ]);
    expect(frames.at(-1)?.ended).toBe(false);
  });

  it("deep copies anchors and handles between replay frames", () => {
    const frames = buildVectorReplayFrames(VALID);
    expect(frames[1].points[1].handleOut).toBeUndefined();
    expect(frames[1].points).not.toBe(frames[2].points);
    expect(frames[1].points[1]).not.toBe(frames[2].points[1]);
  });

  it("returns no frames when final validation fails", () => {
    expect(buildVectorReplayFrames("M(0,0)\nL(1,1)")).toEqual([]);
  });
});
