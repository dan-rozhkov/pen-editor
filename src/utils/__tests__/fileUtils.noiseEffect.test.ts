import { describe, expect, it } from "vitest";
import { serializeDocument, deserializeDocument } from "@/utils/fileUtils";
import type { RectNode } from "@/types/scene";

// Pin: the internal `.pen` format serializes/deserializes nodes generically
// (JSON.stringify/parse of the scene tree), so a noise effect on a node
// survives a save/load cycle with no special-casing required.
describe(".pen noise effect round-trip (serializeDocument/deserializeDocument)", () => {
  it("preserves a noise effect on a node through a save/load cycle", () => {
    const node: RectNode = {
      id: "rect-1",
      type: "rect",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      effects: [
        {
          type: "noise",
          noiseType: "duo",
          color: "#00000080",
          secondaryColor: "#ffffffff",
          noiseSize: 2,
          density: 0.3,
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
  });
});
