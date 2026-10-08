import { describe, expect, it } from "vitest";
import { deserializeDocument, serializeDocument } from "@/utils/fileUtils";

describe("deserializeDocument with untrusted variableCollections", () => {
  it("opens a document whose collection has no modes", () => {
    const json = JSON.stringify({
      version: "1.2",
      pages: [],
      nodes: [],
      variables: [
        { id: "v", name: "--v", type: "color", value: "#123456", collectionId: "bad", valuesByMode: { m: "#123456" } },
      ],
      variableCollections: [{ id: "bad", name: "Bad" }, null, 7],
    });
    const doc = deserializeDocument(json);
    expect(doc.variableCollections?.map((c) => c.id)).toEqual(["theme"]);
    expect(doc.variables[0].collectionId).toBe("theme");
  });
});

describe("serializeDocument", () => {
  it("runs the variable upgrade once", () => {
    const vars = [{ id: "v", name: "--v", type: "color" as const, value: "#111111" }];
    const out = JSON.parse(
      serializeDocument([], vars, "light", [], [], [], [
        { id: "theme", name: "Theme", modes: [{ id: "light", name: "Light" }, { id: "dark", name: "Dark" }], defaultModeId: "light" },
      ]),
    );
    expect(out.variables[0].collectionId).toBe("theme");
    expect(out.variableCollections.map((c: { id: string }) => c.id)).toEqual(["theme"]);
  });
});
