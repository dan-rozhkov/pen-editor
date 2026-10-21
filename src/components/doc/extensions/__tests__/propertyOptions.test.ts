import { afterEach, describe, expect, it } from "vitest";
import { collectTagOptions, docTagOccurrences, rankTagOptions, tagOccurrences, toIsoDate } from "../propertyOptions";
import { destroyLoaded, load } from "../../ui/__tests__/editorFixture";

const HEAD = "|  |  |\n| --- | --- |";
const doc = (...rows: string[]) => [HEAD, ...rows].join("\n");
const tag = (color: string, text: string) => `<span data-bg="${color}">${text}</span>`;

afterEach(destroyLoaded);

describe("collectTagOptions", () => {
  it("dedupes by text case-insensitively and keeps the first colour", () => {
    const a = doc(`| Status | ${tag("green", "Done")} |`);
    const b = doc(`| status | ${tag("red", "done")} |`, `| Status | ${tag("blue", "Todo")} |`);
    expect(collectTagOptions([a, b], " STATUS ")).toEqual([
      { text: "Done", color: "green", count: 2 },
      { text: "Todo", color: "blue", count: 1 },
    ]);
  });

  it("sorts by frequency, then alphabetically", () => {
    const rows = ["Bee", "Ant", "Bee", "Cat"].map((t) => `| K | ${tag("gray", t)} |`);
    expect(collectTagOptions([doc(...rows)], "K").map((o) => o.text)).toEqual(["Bee", "Ant", "Cat"]);
  });

  it("ignores other keys, plain values and mixed values", () => {
    const md = doc(`| Other | ${tag("red", "X")} |`, "| Status | plain |", `| Status | ${tag("red", "Y")} extra |`);
    expect(collectTagOptions([md], "Status")).toEqual([]);
  });

  it("ignores tables that are not property lists and fenced blocks", () => {
    const table = `| Status | Value |\n| --- | --- |\n| Status | ${tag("red", "No")} |`;
    const fenced = "```\n" + doc(`| Status | ${tag("red", "Code")} |`) + "\n```";
    expect(collectTagOptions([table, fenced], "Status")).toEqual([]);
  });

  it("reads escaped pipes in keys and values", () => {
    const md = doc(`| A \\| B | ${tag("pink", "x \\| y")} |`);
    expect(collectTagOptions([md], "A | B")).toEqual([{ text: "x | y", color: "pink", count: 1 }]);
  });

  it("drops colour names outside the palette", () => {
    expect(tagOccurrences(doc(`| K | ${tag("#fff", "Hex")} |`), "K")).toEqual([]);
  });

  it("keeps every chip of a multi-tag value", () => {
    expect(tagOccurrences(doc(`| K | ${tag("red", "A")} ${tag("blue", "B")} |`), "K")).toHaveLength(2);
  });
});

describe("rankTagOptions", () => {
  it("returns nothing for no occurrences", () => {
    expect(rankTagOptions([])).toEqual([]);
  });
});

describe("docTagOccurrences", () => {
  it("reads chips of rows with the same key from a live document", () => {
    const editor = load(doc(`| Status | ${tag("green", "Done")} |`, `| status | ${tag("red", "Todo")} |`, "| Status | plain |", `| Owner | ${tag("blue", "Me")} |`));
    expect(docTagOccurrences(editor.state.doc, "Status")).toEqual([
      { text: "Done", color: "green" },
      { text: "Todo", color: "red" },
    ]);
  });
});

describe("toIsoDate", () => {
  it.each([
    ["2026-10-05", "2026-10-05"],
    ["2026-1-5", "2026-01-05"],
    ["2026-10-05 14:30", "2026-10-05"],
    ["October 5, 2026", "2026-10-05"],
    ["2026-02-30", null],
    ["2026-10-05 → 2026-10-07", null],
    ["hello", null],
    ["", null],
  ])("%s -> %s", (input, expected) => {
    expect(toIsoDate(input)).toBe(expected);
  });
});
