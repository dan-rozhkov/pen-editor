import { describe, expect, it } from "vitest";
import { serializeDocument, deserializeDocument } from "@/utils/fileUtils";
import type { RectNode } from "@/types/scene";

// Pin: like the noise effect (fileUtils.noiseEffect.test.ts), the internal
// `.pen` format serializes/deserializes nodes generically (JSON.stringify/
// parse of the scene tree), so a Glass effect needs no codec of its own —
// this test just proves all seven documented fields plus id/visible survive
// the round trip untouched.
describe(".pen Glass effect round-trip (serializeDocument/deserializeDocument)", () => {
  it("preserves a glass effect on a node through a save/load cycle", () => {
    const node: RectNode = {
      id: "rect-1",
      type: "rect",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      effects: [
        {
          type: "glass",
          id: "glass-1",
          visible: true,
          lightAngle: 210,
          lightIntensity: 0.7,
          refraction: 0.42,
          depth: 16,
          dispersion: 0.22,
          frost: 6,
          splay: 0.55,
        },
      ],
    };

    const json = serializeDocument(
      [{ id: "page-1", name: "Page 1", nodes: [node], pageBackground: "#f5f5f5" }],
      [],
      "light",
    );

    const data = deserializeDocument(json);
    expect(data.pages).toHaveLength(1);
    expect(data.pages[0].nodes).toEqual([node]);

    const roundTripped = data.pages[0].nodes[0] as RectNode;
    const effect = roundTripped.effects?.[0];
    expect(effect).toEqual({
      type: "glass",
      id: "glass-1",
      visible: true,
      lightAngle: 210,
      lightIntensity: 0.7,
      refraction: 0.42,
      depth: 16,
      dispersion: 0.22,
      frost: 6,
      splay: 0.55,
    });
  });
});
