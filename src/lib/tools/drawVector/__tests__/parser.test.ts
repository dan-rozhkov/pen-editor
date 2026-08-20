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
    expect(result.draft.contours).toEqual([
      { points: result.draft.points, closed: true },
    ]);
    expect(result.draft.fillRule).toBeUndefined();
    expect(result.draft.warnings).toEqual([]);
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
    ["too few open anchors (a single M has no geometry)", "M(0,0)\nEND()", 2],
    ["command after CLOSE targeting the closed contour", "M(0,0)\nL(1,0)\nL(1,1)\nCLOSE()\nL(2,2)\nEND()", 5],
    ["unknown command", "M(0,0)\nL(1,1)\nWAT()\nEND()", 3],
    ["bad arity", "M(0)\nL(1,1)\nEND()", 1],
    ["NaN", "M(NaN,0)\nL(1,1)\nEND()", 1],
    ["Infinity", "M(Infinity,0)\nL(1,1)\nEND()", 1],
    ["coordinate too large", "M(1000001,0)\nL(1,1)\nEND()", 1],
    ["bad color", 'M(0,0)\nL(1,1)\nSTROKE("red",1)\nEND()', 3],
    ["general SVG", "M 0 0 L 1 1\nEND()", 1],
    ["comment", "M(0,0)\n// L(1,1)\nEND()", 2],
    ["JSON5", "{ commands: ['M(0,0)'] }", 1],
  ])("rejects %s", (_name, source, line) => {
    const result = parseVectorCommands(source, "final");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.line).toBe(line);
  });

  it("rejects a script with zero usable geometry even though every line parses", () => {
    // Two lone M's, each dropped as a single-anchor contour -> nothing left.
    const result = parseVectorCommands("M(0,0)\nM(1,1)\nEND()", "final");
    expect(result.ok).toBe(false);
  });

  it("rejects more than 32,768 characters", () => {
    const result = parseVectorCommands(" ".repeat(32_769), "final");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.line).toBe(1);
  });

  it("rejects complete invalid lines in preview mode", () => {
    expect(parseVectorCommands("M(0,0)\nNOPE()\n", "preview").ok).toBe(false);
  });

  describe("tolerant recovery (recoverable issues succeed with warnings)", () => {
    it("starts a new subcontour on a second M instead of failing", () => {
      const result = parseVectorCommands(
        [
          "M(0,0)",
          "L(10,0)",
          "L(10,10)",
          "L(0,10)",
          "CLOSE()",
          "M(3,3)",
          "L(7,3)",
          "L(7,7)",
          "L(3,7)",
          "CLOSE()",
          'FILL("#ff0000")',
          "END()",
        ].join("\n"),
        "final",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.contours).toHaveLength(2);
      expect(result.draft.contours[0]).toEqual({
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        closed: true,
      });
      expect(result.draft.contours[1]).toEqual({
        points: [
          { x: 3, y: 3 },
          { x: 7, y: 3 },
          { x: 7, y: 7 },
          { x: 3, y: 7 },
        ],
        closed: true,
      });
      // Multi-contour representation: one combined "d" string (each closed
      // subpath's own trailing "back to start" segment plus "Z", matching
      // `anchorsToSVGPath`'s existing single-contour output), evenodd fill
      // rule, and no single top-level `closed` flag (only meaningful for one
      // contour).
      expect(result.draft.geometry).toBe(
        "M0,0 L10,0 L10,10 L0,10 L0,0 Z M3,3 L7,3 L7,7 L3,7 L3,3 Z",
      );
      expect(result.draft.fillRule).toBe("evenodd");
      expect(result.draft.closed).toBe(false);
      expect(result.draft.points).toHaveLength(8);
      expect(result.draft.fill).toBe("#ff0000");
      expect(result.draft.warnings).toEqual([]);
    });

    it("closes an under-anchored closed contour as open instead of failing", () => {
      const result = parseVectorCommands("M(0,0)\nL(1,1)\nCLOSE()\nEND()", "final");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.closed).toBe(false);
      expect(result.draft.points).toHaveLength(2);
      expect(result.draft.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("at least 3 anchors")]),
      );
    });

    it("allows FILL on an open contour (SVG closes it implicitly for fill)", () => {
      const result = parseVectorCommands('M(0,0)\nL(1,1)\nFILL("#ffffff")\nEND()', "final");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.closed).toBe(false);
      expect(result.draft.fill).toBe("#ffffff");
      expect(result.draft.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("open contour")]),
      );
    });

    it("ignores commands after END instead of failing", () => {
      const result = parseVectorCommands("M(0,0)\nL(1,1)\nEND()\nL(2,2)", "final");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.points).toHaveLength(2);
      expect(result.draft.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("ignored")]),
      );
    });

    it("treats a missing END as a completed stream", () => {
      const result = parseVectorCommands("M(0,0)\nL(1,1)", "final");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.ended).toBe(false);
      expect(result.draft.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("END() was missing")]),
      );
    });

    it.each([
      ["zero", 0],
      ["negative", -5],
      ["too large", 101],
    ])("clamps a %s stroke width instead of failing", (_label, width) => {
      const result = parseVectorCommands(
        `M(0,0)\nL(1,1)\nSTROKE("#ffffff",${width})\nEND()`,
        "final",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.stroke!.width).toBeGreaterThan(0);
      expect(result.draft.stroke!.width).toBeLessThanOrEqual(100);
      expect(result.draft.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("clamped")]),
      );
    });

    it("ignores a duplicate CLOSE on the same contour", () => {
      const result = parseVectorCommands(
        "M(0,0)\nL(1,0)\nL(1,1)\nCLOSE()\nCLOSE()\nEND()",
        "final",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.closed).toBe(true);
      expect(result.draft.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("duplicate CLOSE")]),
      );
    });

    it("keeps only the last FILL when it is specified twice", () => {
      const result = parseVectorCommands(
        'M(0,0)\nL(1,0)\nL(1,1)\nCLOSE()\nFILL("#ffffff")\nFILL("#000000")\nEND()',
        "final",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.fill).toBe("#000000");
      expect(result.draft.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("duplicate FILL")]),
      );
    });

    it("keeps only the last STROKE when it is specified twice", () => {
      const result = parseVectorCommands(
        'M(0,0)\nL(1,1)\nSTROKE("#ffffff",1)\nSTROKE("#000000",2)\nEND()',
        "final",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.stroke).toEqual({ color: "#000000", width: 2 });
      expect(result.draft.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("duplicate STROKE")]),
      );
    });

    it("truncates past the anchor limit instead of failing", () => {
      const source = [
        "M(0,0)",
        ...Array.from({ length: 600 }, (_, i) => `L(${i + 1},1)`),
        "END()",
      ].join("\n");
      const result = parseVectorCommands(source, "final");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.points.length).toBeLessThanOrEqual(512);
      expect(result.draft.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("512-anchor limit")]),
      );
    });

    it("is case-insensitive, accepts Z as CLOSE, and tolerates semicolons/mixed separators", () => {
      const result = parseVectorCommands(
        ["m(0 0);", "l(10, 0);", "l(10 10);", "z();", "end();"].join("\n"),
        "final",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.closed).toBe(true);
      expect(result.draft.points).toHaveLength(3);
    });

    it("skips markdown code-fence lines around the commands", () => {
      const result = parseVectorCommands(
        ["```", "M(0,0)", "L(1,1)", "END()", "```"].join("\n"),
        "final",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.points).toHaveLength(2);
    });

    it.each([
      ["#f00", "#ff0000"],
      ["#f00a", "#ff0000aa"],
      ["rgb(255, 0, 0)", "#ff0000"],
      ["rgba(255, 0, 0, 0.5)", "#ff000080"],
      ["none", undefined],
      ["transparent", undefined],
    ])("normalizes color %s to %s", (input, expected) => {
      const result = parseVectorCommands(
        `M(0,0)\nL(1,0)\nL(1,1)\nCLOSE()\nFILL("${input}")\nEND()`,
        "final",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.fill).toBe(expected);
    });
  });
});

describe("code review fixes", () => {
  it("rejects an rgb() color with a malformed component instead of producing NaN in the hex", () => {
    // "1.2.3" fully matches the old [\d.]+ character class (multiple
    // embedded dots), so Number("1.2.3") was NaN and clampByte(NaN) still
    // returns NaN -> "#NaN0000" silently committed into the scene.
    const result = parseVectorCommands(
      'M(0,0)\nL(1,1)\nFILL("rgb(1.2.3, 0, 0)")\nEND()',
      "final",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Unrecognized color format");
    expect(result.line).toBe(3);
  });

  it("does not fatally reject CLOSE() when the anchor limit was hit on the M that opened the contour", () => {
    // 600 L's exhaust MAX_ANCHORS (512) on the first contour; the second
    // M(5,5) then opens a contour with an empty points array (dropped for
    // the same reason). CLOSE on that state used to be treated as "no M
    // happened at all" and reject the entire script.
    const source = [
      "M(0,0)",
      ...Array.from({ length: 600 }, (_, i) => `L(${i + 1},1)`),
      "M(5,5)",
      "L(6,6)",
      "CLOSE()",
      "END()",
    ].join("\n");
    const result = parseVectorCommands(source, "final");
    expect(result.ok).toBe(true);
  });

  it("still fails CLOSE() fatally when no M ever opened a contour", () => {
    const result = parseVectorCommands("CLOSE()\nEND()", "final");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("CLOSE requires M");
    expect(result.line).toBe(1);
  });

  it("accepts an unquoted rgb()/rgba() color without splitArgs slicing it apart on the commas", () => {
    const result = parseVectorCommands(
      "M(0,0)\nL(1,0)\nL(1,1)\nCLOSE()\nFILL(rgb(255, 0, 0))\nEND()",
      "final",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.fill).toBe("#ff0000");
  });

  it("clamps out-of-range rgb() components (including negative) instead of rejecting them", () => {
    const result = parseVectorCommands(
      'M(0,0)\nL(1,0)\nL(1,1)\nCLOSE()\nFILL("rgb(300, -5, 0)")\nEND()',
      "final",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.fill).toBe("#ff0000");
  });

  it("accepts bare Z/END (no parens) the way the SVG-habit alias implies", () => {
    const result = parseVectorCommands("M(0,0)\nL(10,0)\nL(10,10)\nZ\nEND", "final");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.closed).toBe(true);
  });

  it("accepts bare CLOSE (no parens)", () => {
    const result = parseVectorCommands("M(0,0)\nL(10,0)\nL(10,10)\nCLOSE\nEND()", "final");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.closed).toBe(true);
  });

  it("clamps a vanishingly small positive stroke width up to MIN_STROKE_WIDTH", () => {
    const result = parseVectorCommands(
      'M(0,0)\nL(1,1)\nSTROKE("#ffffff",1e-9)\nEND()',
      "final",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.stroke!.width).toBeGreaterThanOrEqual(0.1);
    expect(result.draft.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("clamped")]),
    );
  });
});

describe("bareword (no-parens) command form", () => {
  it("parses bareword M/L/C exactly like the parenthesized form", () => {
    const bareword = parseVectorCommands(
      "m 120 320\nl 260 300\nc 300 420 360 240 440 340\nEND()",
      "final",
    );
    const parenthesized = parseVectorCommands(
      "M(120, 320)\nL(260, 300)\nC(300, 420, 360, 240, 440, 340)\nEND()",
      "final",
    );
    expect(bareword.ok).toBe(true);
    expect(parenthesized.ok).toBe(true);
    if (!bareword.ok || !parenthesized.ok) return;
    expect(bareword.draft.points).toEqual(parenthesized.draft.points);
    expect(bareword.draft.geometry).toBe(parenthesized.draft.geometry);
  });

  it("parses bareword FILL with an unquoted hex color", () => {
    const result = parseVectorCommands(
      "M(0,0)\nL(1,0)\nL(1,1)\nCLOSE()\nfill #e0522a\nEND()",
      "final",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.fill).toBe("#e0522a");
  });

  it("parses bareword STROKE with color and width", () => {
    const result = parseVectorCommands(
      "M(0,0)\nL(1,1)\nstroke #0d99ff 2\nEND()",
      "final",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.stroke).toEqual({ color: "#0d99ff", width: 2 });
  });

  it("parses bareword FILL with an unquoted rgb() color, commas and all", () => {
    const result = parseVectorCommands(
      "M(0,0)\nL(1,0)\nL(1,1)\nCLOSE()\nfill rgb(255, 0, 0)\nEND()",
      "final",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.fill).toBe("#ff0000");
  });

  it("mixes parenthesized and bareword lines in one script", () => {
    const result = parseVectorCommands(
      ["m 0 0", "L(10, 0)", "l 10 10", "CLOSE()", "fill #00ff00", "END()"].join("\n"),
      "final",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.points).toHaveLength(3);
    expect(result.draft.fill).toBe("#00ff00");
  });

  it("still fails fatally on a bareword command missing an argument", () => {
    const result = parseVectorCommands("m 120\nEND()", "final");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Unknown command or invalid arguments");
    expect(result.line).toBe(1);
  });

  it("still fails fatally on a line that isn't a command at all", () => {
    const result = parseVectorCommands("this is not a command\nEND()", "final");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.line).toBe(1);
  });

  it("keeps bareword commands' feed into buildVectorReplayFrames working", () => {
    const frames = buildVectorReplayFrames(
      ["m 0 0", "l 10 0", "l 10 10", "CLOSE()", "fill #00ff00", "END()"].join("\n"),
    );
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.at(-1)?.fill).toBe("#00ff00");
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
    expect(buildVectorReplayFrames("M(0,0)\nL(1,1)\nWAT()")).toEqual([]);
  });

  it("shows every subcontour's anchors while a multi-contour script streams in", () => {
    const frames = buildVectorReplayFrames(
      ["M(0,0)", "L(1,0)", "M(5,5)", "L(6,5)", "END()"].join("\n"),
    );
    // Last frame (before END) sees both subcontours' anchors.
    expect(frames.at(-1)?.points).toHaveLength(4);
  });
});
