import { describe, it, expect } from "vitest";
import { lineNodeToSvg, pathNodeToSvg, polygonNodeToSvg } from "../svgGeneration";
import { applyOpacity } from "@/utils/colorUtils";
import type { LineNode, PathNode, PolygonNode, GradientFill, Paint } from "@/types/scene";

function lineNode(extra: Partial<LineNode>): LineNode {
  return {
    id: "line1",
    type: "line",
    x: 0,
    y: 0,
    width: 100,
    height: 0,
    points: [0, 0, 100, 0],
    stroke: "#000000",
    strokeWidth: 2,
    ...extra,
  };
}

function pathNode(extra: Partial<PathNode>): PathNode {
  return {
    id: "p1",
    type: "path",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    geometry: "M0 0 L100 0 L100 100 L0 100 Z",
    ...extra,
  };
}

function polygonNode(extra: Partial<PolygonNode>): PolygonNode {
  return {
    id: "poly1",
    type: "polygon",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    points: [0, 0, 100, 0, 50, 100],
    ...extra,
  };
}

const linearGradient: GradientFill = {
  type: "linear",
  stops: [
    { color: "#ff0000", position: 0 },
    { color: "#0000ff", position: 1 },
  ],
  startX: 0,
  startY: 0,
  endX: 0,
  endY: 1,
};

describe("pathNodeToSvg", () => {
  it("legacy fill/fillOpacity → single path, no defs (back-compat)", () => {
    const svg = pathNodeToSvg(pathNode({ fill: "#ff0000", fillOpacity: 0.5 }));
    const matches = svg.match(/<path/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(svg).toContain(`fill="${applyOpacity("#ff0000", 0.5)}"`);
    expect(svg).not.toContain("<defs>");
  });

  it("no fills at all → fill=none single element", () => {
    const svg = pathNodeToSvg(pathNode({}));
    const matches = svg.match(/<path/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(svg).toContain('fill="none"');
  });

  it("fills: [solid, gradient] → two paths bottom-to-top, one gradient def", () => {
    const fills: Paint[] = [
      { id: "p1", type: "solid", color: "#112233" },
      { id: "p2", type: "gradient", gradient: linearGradient },
    ];
    const svg = pathNodeToSvg(pathNode({ fills }));
    const matches = svg.match(/<path/g) ?? [];
    expect(matches).toHaveLength(2);

    const defsMatch = svg.match(/<linearGradient/g) ?? [];
    expect(defsMatch).toHaveLength(1);
    expect(svg).toContain("<defs>");

    // bottom solid path before top gradient path
    const solidIdx = svg.indexOf(`fill="#112233"`);
    const gradIdx = svg.indexOf('fill="url(#');
    expect(solidIdx).toBeGreaterThan(-1);
    expect(gradIdx).toBeGreaterThan(solidIdx);
    expect(svg).toContain('fill="url(#');
  });

  it("paint with visible: false is excluded", () => {
    const fills: Paint[] = [
      { id: "p1", type: "solid", color: "#112233" },
      { id: "p2", type: "solid", color: "#ffffff", visible: false },
    ];
    const svg = pathNodeToSvg(pathNode({ fills }));
    const matches = svg.match(/<path/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(svg).not.toContain("#ffffff");
  });

  it("stroke appears exactly once, on the topmost layer", () => {
    const fills: Paint[] = [
      { id: "p1", type: "solid", color: "#112233" },
      { id: "p2", type: "solid", color: "#ffffff" },
    ];
    const svg = pathNodeToSvg(
      pathNode({ fills, stroke: "#000000", strokeWidth: 2 }),
    );
    const strokeMatches = svg.match(/stroke="/g) ?? [];
    expect(strokeMatches).toHaveLength(1);
    // stroke must be attached to the last path element (topmost layer)
    const lastPathStart = svg.lastIndexOf("<path");
    const strokeIdx = svg.indexOf('stroke="');
    expect(strokeIdx).toBeGreaterThan(lastPathStart);
  });
});

describe("lineNodeToSvg", () => {
  it("renders a plain <line> with no markers when caps are unset", () => {
    const svg = lineNodeToSvg(lineNode({}));
    expect(svg).toContain("<line");
    expect(svg).not.toContain("marker-start");
    expect(svg).not.toContain("marker-end");
    expect(svg).not.toContain("<marker");
  });

  it("adds marker defs + marker-start/marker-end for arrowhead caps", () => {
    const svg = lineNodeToSvg(lineNode({ startCap: "bar", endCap: "arrow" }));
    expect(svg).toContain("marker-start=");
    expect(svg).toContain("marker-end=");
    expect(svg.match(/<marker/g)?.length).toBe(2);
    expect(svg).toContain('orient="auto-start-reverse"');
    expect(svg).toContain('orient="auto"');
  });

  it("anchors cap markers at refX=0 refY=0, not offset by the viewBox origin", () => {
    const svg = lineNodeToSvg(lineNode({ startCap: "triangle", endCap: "triangle" }));
    const markerDefs = svg.match(/<marker[^>]*>/g) ?? [];
    expect(markerDefs.length).toBe(2);
    for (const def of markerDefs) {
      expect(def).toContain('refX="0"');
      expect(def).toContain('refY="0"');
    }
  });

  it("the 'bar' cap marker has non-zero markerWidth/markerHeight (a naive bbox collapses to width=0)", () => {
    const svg = lineNodeToSvg(lineNode({ startCap: "bar", endCap: "none" }));
    const def = svg.match(/<marker[^>]*>/)?.[0] ?? "";
    const width = Number(def.match(/markerWidth="([^"]+)"/)?.[1]);
    const height = Number(def.match(/markerHeight="([^"]+)"/)?.[1]);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });
});

describe("polygonNodeToSvg", () => {
  it("two solid fills → two polygon elements, stroke exactly once", () => {
    const fills: Paint[] = [
      { id: "p1", type: "solid", color: "#112233" },
      { id: "p2", type: "solid", color: "#ffffff" },
    ];
    const svg = polygonNodeToSvg(
      polygonNode({ fills, stroke: "#000000", strokeWidth: 2 }),
    );
    const matches = svg.match(/<polygon/g) ?? [];
    expect(matches).toHaveLength(2);
    const strokeMatches = svg.match(/stroke="/g) ?? [];
    expect(strokeMatches).toHaveLength(1);
    const lastPolygonStart = svg.lastIndexOf("<polygon");
    const strokeIdx = svg.indexOf('stroke="');
    expect(strokeIdx).toBeGreaterThan(lastPolygonStart);
  });

  it("legacy fill → single polygon, no defs", () => {
    const svg = polygonNodeToSvg(polygonNode({ fill: "#00ff00" }));
    const matches = svg.match(/<polygon/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(svg).not.toContain("<defs>");
  });

  it("no fills → fill=none", () => {
    const svg = polygonNodeToSvg(polygonNode({}));
    expect(svg).toContain('fill="none"');
  });
});
