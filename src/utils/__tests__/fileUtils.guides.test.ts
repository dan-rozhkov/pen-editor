import { describe, expect, it } from "vitest";
import { serializeDocument, deserializeDocument } from "@/utils/fileUtils";
import type { Guide } from "@/store/guidesStore";

describe(".pen guides round-trip (serializeDocument/deserializeDocument)", () => {
  it("preserves guides for each page through a save/load cycle", () => {
    const guides: Guide[] = [
      { id: "g1", orientation: "vertical", position: 120 },
      { id: "g2", orientation: "horizontal", position: -40 },
    ];

    const json = serializeDocument(
      [
        {
          id: "page-1",
          name: "Page 1",
          nodes: [],
          pageBackground: "#f5f5f5",
          guides,
        },
      ],
      [],
      "light",
    );

    const data = deserializeDocument(json);
    expect(data.pages).toHaveLength(1);
    expect(data.pages[0].guides).toEqual(guides);
  });

  it("defaults to an empty guides array when a page has none", () => {
    const json = serializeDocument(
      [{ id: "page-1", name: "Page 1", nodes: [], pageBackground: "#f5f5f5" }],
      [],
      "light",
    );

    const data = deserializeDocument(json);
    expect(data.pages[0].guides).toEqual([]);
  });

  it("defaults to an empty guides array for legacy single-page documents", () => {
    const legacyJson = JSON.stringify({ version: "1.0", nodes: [] });
    const data = deserializeDocument(legacyJson);
    expect(data.pages[0].guides).toEqual([]);
  });

  it("omits the guides key from JSON when a page has no guides (keeps files lean)", () => {
    const json = serializeDocument(
      [{ id: "page-1", name: "Page 1", nodes: [], pageBackground: "#f5f5f5", guides: [] }],
      [],
      "light",
    );
    const doc = JSON.parse(json);
    expect(doc.pages[0].guides).toBeUndefined();
  });
});
