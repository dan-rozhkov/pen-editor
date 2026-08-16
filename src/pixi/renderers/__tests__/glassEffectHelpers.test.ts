import { describe, it, expect } from "vitest";
import { UniformGroup } from "pixi.js";
import {
  resolveCornerRadii,
  isEllipseShape,
  createGlassUniformGroup,
  writeGlassGeometryUniforms,
  writeGlassEffectUniforms,
  computeMaterialSurfacePadding,
  MAX_MATERIAL_PADDING,
} from "../glassEffectHelpers";
import { createGlassEffect, normalizeGlassEffect } from "@/utils/fillUtils";
import type { FlatSceneNode } from "@/types/scene";

function rectNode(over: Partial<FlatSceneNode> = {}): FlatSceneNode {
  return { id: "n1", type: "rect", x: 0, y: 0, width: 100, height: 80, ...over } as FlatSceneNode;
}

describe("resolveCornerRadii", () => {
  it("returns all-zero radii for an ellipse", () => {
    expect(resolveCornerRadii(rectNode({ type: "ellipse" }), 100, 80)).toEqual([0, 0, 0, 0]);
  });

  it("uses per-corner radii in TL, TR, BR, BL order when set", () => {
    const node = rectNode({
      cornerRadiusPerCorner: { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 },
    });
    expect(resolveCornerRadii(node, 100, 80)).toEqual([1, 2, 3, 4]);
  });

  it("defaults missing per-corner values to 0", () => {
    const node = rectNode({ cornerRadiusPerCorner: { topLeft: 5 } });
    expect(resolveCornerRadii(node, 100, 80)).toEqual([5, 0, 0, 0]);
  });

  it("falls back to the unified cornerRadius applied to all four corners", () => {
    expect(resolveCornerRadii(rectNode({ cornerRadius: 8 }), 100, 80)).toEqual([8, 8, 8, 8]);
  });

  it("clamps a full-circle radius on a square node to half the side", () => {
    expect(resolveCornerRadii(rectNode({ cornerRadius: 1000, width: 50, height: 50 }), 50, 50)).toEqual([
      25, 25, 25, 25,
    ]);
  });

  it("defaults to zero radii when nothing is set", () => {
    expect(resolveCornerRadii(rectNode(), 100, 80)).toEqual([0, 0, 0, 0]);
  });
});

describe("isEllipseShape", () => {
  it("true only for ellipse nodes", () => {
    expect(isEllipseShape(rectNode({ type: "ellipse" }))).toBe(true);
    expect(isEllipseShape(rectNode({ type: "rect" }))).toBe(false);
  });
});

describe("writeGlassGeometryUniforms", () => {
  it("writes size, radii, and the ellipse flag without touching effect-param fields", () => {
    const group = createGlassUniformGroup();
    group.uniforms.uParams[0] = 0.7; // sentinel — must survive a geometry-only write
    const node = rectNode({ cornerRadius: 10 });

    writeGlassGeometryUniforms(group, node, 120, 60);

    expect(Array.from(group.uniforms.uSize)).toEqual([120, 60]);
    expect(Array.from(group.uniforms.uRadii)).toEqual([10, 10, 10, 10]);
    expect(group.uniforms.uIsEllipse).toBe(0);
    expect(group.uniforms.uParams[0]).toBeCloseTo(0.7, 5);
  });

  it("sets uIsEllipse to 1 for an ellipse, 0 otherwise", () => {
    const group = createGlassUniformGroup();
    writeGlassGeometryUniforms(group, rectNode({ type: "ellipse" }), 100, 100);
    expect(group.uniforms.uIsEllipse).toBe(1);

    writeGlassGeometryUniforms(group, rectNode({ type: "rect" }), 100, 100);
    expect(group.uniforms.uIsEllipse).toBe(0);
  });

  it("writes the same Float32Array instances in place (no reallocation)", () => {
    const group = createGlassUniformGroup();
    const sizeRef = group.uniforms.uSize;
    writeGlassGeometryUniforms(group, rectNode(), 10, 10);
    expect(group.uniforms.uSize).toBe(sizeRef);
  });

  it("defaults uCornerSmoothing to 0 when the node has none", () => {
    const group = createGlassUniformGroup();
    writeGlassGeometryUniforms(group, rectNode(), 100, 80);
    expect(group.uniforms.uCornerSmoothing).toBe(0);
  });

  it("writes the node's cornerSmoothing fraction", () => {
    const group = createGlassUniformGroup();
    writeGlassGeometryUniforms(group, rectNode({ cornerSmoothing: 0.6 } as Partial<FlatSceneNode>), 100, 80);
    expect(group.uniforms.uCornerSmoothing).toBeCloseTo(0.6, 5);
  });

  it("clamps uCornerSmoothing to 0..1", () => {
    const group = createGlassUniformGroup();
    writeGlassGeometryUniforms(group, rectNode({ cornerSmoothing: 5 } as Partial<FlatSceneNode>), 100, 80);
    expect(group.uniforms.uCornerSmoothing).toBe(1);

    const group2 = createGlassUniformGroup();
    writeGlassGeometryUniforms(group2, rectNode({ cornerSmoothing: -3 } as Partial<FlatSceneNode>), 100, 80);
    expect(group2.uniforms.uCornerSmoothing).toBe(0);
  });

  it("survives a resize (geometry writer preserves cornerSmoothing across repeated calls)", () => {
    const group = createGlassUniformGroup();
    const node = rectNode({ cornerSmoothing: 0.4 } as Partial<FlatSceneNode>);
    writeGlassGeometryUniforms(group, node, 100, 80);
    writeGlassGeometryUniforms(group, node, 200, 160);
    expect(group.uniforms.uCornerSmoothing).toBeCloseTo(0.4, 5);
    expect(Array.from(group.uniforms.uSize)).toEqual([200, 160]);
  });
});

describe("writeGlassEffectUniforms", () => {
  it("packs refraction/depth/dispersion/splay into uParams in order", () => {
    const group = createGlassUniformGroup();
    const effect = createGlassEffect({ refraction: 0.4, depth: 20, dispersion: 0.25, splay: 0.6 });

    writeGlassEffectUniforms(group, effect, rectNode(), 100, 80);

    const [refraction, depth, dispersion, splay] = group.uniforms.uParams;
    expect(refraction).toBeCloseTo(0.4, 5);
    expect(depth).toBe(20);
    expect(dispersion).toBeCloseTo(0.25, 5);
    expect(splay).toBeCloseTo(0.6, 5);
  });

  it("clamps depth to at least 1", () => {
    const group = createGlassUniformGroup();
    writeGlassEffectUniforms(group, createGlassEffect({ depth: 0 }), rectNode(), 100, 80);
    expect(group.uniforms.uParams[1]).toBe(1);
  });

  it("converts lightAngle degrees to cos/sin, radians correctly", () => {
    const group = createGlassUniformGroup();
    writeGlassEffectUniforms(group, createGlassEffect({ lightAngle: 90 }), rectNode(), 100, 80);
    expect(group.uniforms.uLight[0]).toBeCloseTo(Math.cos(Math.PI / 2), 5);
    expect(group.uniforms.uLight[1]).toBeCloseTo(Math.sin(Math.PI / 2), 5);
  });

  it("light angle 0 -> cos 1, sin 0", () => {
    const group = createGlassUniformGroup();
    writeGlassEffectUniforms(group, createGlassEffect({ lightAngle: 0 }), rectNode(), 100, 80);
    expect(group.uniforms.uLight[0]).toBeCloseTo(1, 5);
    expect(group.uniforms.uLight[1]).toBeCloseTo(0, 5);
  });

  it("packs lightIntensity into uLight.z and vibrancy into uLight.w", () => {
    const group = createGlassUniformGroup();
    writeGlassEffectUniforms(
      group,
      createGlassEffect({ lightIntensity: 0.75, vibrancy: 0.9 }),
      rectNode(),
      100,
      80,
    );
    expect(group.uniforms.uLight[2]).toBe(0.75);
    expect(group.uniforms.uLight[3]).toBeCloseTo(0.9, 5);
  });

  it("packs vibrancy 0 into uLight.w (background-blur's zeroed mapping)", () => {
    const group = createGlassUniformGroup();
    writeGlassEffectUniforms(group, createGlassEffect({ vibrancy: 0 }), rectNode(), 100, 80);
    expect(group.uniforms.uLight[3]).toBe(0);
  });

  it("falls back to the documented default when vibrancy is missing (defensive — callers should pass an already-normalized effect)", () => {
    const group = createGlassUniformGroup();
    const effect = createGlassEffect();
    // Simulate a not-yet-normalized effect missing the field entirely.
    delete (effect as { vibrancy?: number }).vibrancy;
    writeGlassEffectUniforms(group, effect, rectNode(), 100, 80);
    expect(group.uniforms.uLight[3]).toBe(0.5);
  });

  it("also writes geometry fields (size, radii, ellipse flag) via the shared helper", () => {
    const group = createGlassUniformGroup();
    writeGlassEffectUniforms(group, createGlassEffect(), rectNode({ cornerRadius: 4 }), 100, 80);
    expect(Array.from(group.uniforms.uSize)).toEqual([100, 80]);
    expect(Array.from(group.uniforms.uRadii)).toEqual([4, 4, 4, 4]);
    expect(group.uniforms.uIsEllipse).toBe(0);
  });

  it("passes the node's cornerSmoothing through via the shared geometry helper, untouched by effect params", () => {
    const group = createGlassUniformGroup();
    const node = rectNode({ cornerSmoothing: 0.75 } as Partial<FlatSceneNode>);
    writeGlassEffectUniforms(group, createGlassEffect({ refraction: 0.2, vibrancy: 0.9 }), node, 100, 80);
    expect(group.uniforms.uCornerSmoothing).toBeCloseTo(0.75, 5);
  });
});

describe("createGlassUniformGroup", () => {
  it("returns a UniformGroup with all fields zeroed and the right shapes", () => {
    const group = createGlassUniformGroup();
    expect(group).toBeInstanceOf(UniformGroup);
    expect(group.uniforms.uSize.length).toBe(2);
    expect(group.uniforms.uRadii.length).toBe(4);
    expect(group.uniforms.uParams.length).toBe(4);
    expect(group.uniforms.uLight.length).toBe(4);
    expect(group.uniforms.uToLocalA.length).toBe(3);
    expect(group.uniforms.uToLocalB.length).toBe(3);
    expect(group.uniforms.uWorldA.length).toBe(2);
    expect(group.uniforms.uWorldB.length).toBe(2);
    expect(group.uniforms.uIsEllipse).toBe(0);
    expect(group.uniforms.uCornerSmoothing).toBe(0);
    expect(Array.from(group.uniforms.uToLocalA)).toEqual([0, 0, 0]);
    expect(Array.from(group.uniforms.uWorldA)).toEqual([0, 0]);
  });
});

describe("computeMaterialSurfacePadding", () => {
  it("grows with refraction * depth", () => {
    const low = computeMaterialSurfacePadding(
      createGlassEffect({ refraction: 0.1, depth: 10, dispersion: 0, frost: 0 }),
    );
    const high = computeMaterialSurfacePadding(
      createGlassEffect({ refraction: 0.9, depth: 100, dispersion: 0, frost: 0 }),
    );
    expect(high).toBeGreaterThan(low);
  });

  it("grows with frost", () => {
    const noFrost = computeMaterialSurfacePadding(
      createGlassEffect({ refraction: 0, depth: 1, dispersion: 0, frost: 0 }),
    );
    const frosted = computeMaterialSurfacePadding(
      createGlassEffect({ refraction: 0, depth: 1, dispersion: 0, frost: 30 }),
    );
    expect(frosted).toBeGreaterThan(noFrost);
    expect(frosted).toBeGreaterThanOrEqual(30);
  });

  it("dispersion widens the reach beyond refraction * depth alone", () => {
    const base = createGlassEffect({ refraction: 0.8, depth: 50, frost: 0 });
    const noDispersion = computeMaterialSurfacePadding({ ...base, dispersion: 0 });
    const withDispersion = computeMaterialSurfacePadding({ ...base, dispersion: 1 });
    expect(withDispersion).toBeGreaterThan(noDispersion);
  });

  it("is always a non-negative integer", () => {
    const padding = computeMaterialSurfacePadding(createGlassEffect({ refraction: 0.37, depth: 12.6, frost: 8.2 }));
    expect(Number.isInteger(padding)).toBe(true);
    expect(padding).toBeGreaterThanOrEqual(0);
  });

  it("is capped at MAX_MATERIAL_PADDING for a pathological effect", () => {
    const padding = computeMaterialSurfacePadding(
      createGlassEffect({ refraction: 1, depth: 1000, dispersion: 1, frost: 100 }),
    );
    expect(padding).toBe(MAX_MATERIAL_PADDING);
  });

  it("a fully-zeroed (no-op) effect needs no padding", () => {
    expect(
      computeMaterialSurfacePadding(createGlassEffect({ refraction: 0, depth: 1, dispersion: 0, frost: 0 })),
    ).toBe(0);
  });
});

describe("normalizeGlassEffect (integration sanity: NaN/out-of-range input still packs cleanly)", () => {
  it("a normalized malformed effect still writes finite uniform values", () => {
    const malformed = createGlassEffect({
      lightAngle: NaN,
      refraction: 5,
      depth: -3,
      dispersion: -1,
      splay: 2,
    });
    const normalized = normalizeGlassEffect(malformed);
    const group = createGlassUniformGroup();
    writeGlassEffectUniforms(group, normalized, rectNode(), 100, 80);

    for (const key of ["uParams", "uLight"] as const) {
      for (const v of group.uniforms[key]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});
