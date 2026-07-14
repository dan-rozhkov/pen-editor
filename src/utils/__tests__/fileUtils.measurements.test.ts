import { describe, expect, it } from "vitest";
import { serializeDocument, deserializeDocument } from "@/utils/fileUtils";
import type { PersistedMeasurement } from "@/store/measurementsStore";

describe(".pen measurements round-trip (serializeDocument/deserializeDocument)", () => {
  it("preserves measurements for each page through a save/load cycle", () => {
    const measurements: PersistedMeasurement[] = [
      { id: "m1", fromId: "rect1", toId: "rect2" },
      { id: "m2", fromId: "frame1", toId: "text1" },
    ];

    const json = serializeDocument(
      [
        {
          id: "page-1",
          name: "Page 1",
          nodes: [],
          pageBackground: "#f5f5f5",
          measurements,
        },
      ],
      [],
      "light",
    );

    const data = deserializeDocument(json);
    expect(data.pages).toHaveLength(1);
    expect(data.pages[0].measurements).toEqual(measurements);
  });

  it("defaults to an empty measurements array when a page has none", () => {
    const json = serializeDocument(
      [{ id: "page-1", name: "Page 1", nodes: [], pageBackground: "#f5f5f5" }],
      [],
      "light",
    );

    const data = deserializeDocument(json);
    expect(data.pages[0].measurements).toEqual([]);
  });

  it("defaults to an empty measurements array for legacy single-page documents", () => {
    const legacyJson = JSON.stringify({ version: "1.0", nodes: [] });
    const data = deserializeDocument(legacyJson);
    expect(data.pages[0].measurements).toEqual([]);
  });

  it("omits the measurements key from JSON when a page has none (keeps files lean)", () => {
    const json = serializeDocument(
      [{ id: "page-1", name: "Page 1", nodes: [], pageBackground: "#f5f5f5", measurements: [] }],
      [],
      "light",
    );
    const doc = JSON.parse(json);
    expect(doc.pages[0].measurements).toBeUndefined();
  });
});
