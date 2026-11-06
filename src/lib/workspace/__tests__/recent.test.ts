import { describe, expect, it } from "vitest";

import { ALL_KINDS, filterRecent, type RecentItem } from "../recent";

const DAY = 86_400_000;
// Local noon, so "today" starts 12 h earlier whatever the time zone.
const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime();
const item = (id: string, title: string, ago: number, kind: RecentItem["kind"] = "doc"): RecentItem => ({
  kind,
  id,
  title,
  updatedAt: NOW - ago,
});
const ITEMS = [
  item("a", "Landing", 1000, "canvas"),
  item("b", "Brief", 13 * 3600_000),
  item("c", "", 3 * DAY, "workflow"),
  item("d", "Old plan", 40 * DAY),
];
const ids = (list: RecentItem[]) => list.map((i) => i.id);

describe("filterRecent", () => {
  it("matches titles case-insensitively, an empty title as Untitled", () => {
    expect(ids(filterRecent(ITEMS, " LAND ", ALL_KINDS, "any", NOW))).toEqual(["a"]);
    expect(ids(filterRecent(ITEMS, "untitled", ALL_KINDS, "any", NOW))).toEqual(["c"]);
  });

  it("filters by kind; all kinds off lists nothing", () => {
    expect(ids(filterRecent(ITEMS, "", { ...ALL_KINDS, doc: false }, "any", NOW))).toEqual(["a", "c"]);
    expect(filterRecent(ITEMS, "", { canvas: false, doc: false, workflow: false }, "any", NOW)).toEqual([]);
  });

  it.each([
    ["any", ["a", "b", "c", "d"]],
    ["today", ["a"]],
    ["7d", ["a", "b", "c"]],
    ["30d", ["a", "b", "c"]],
  ] as const)("modified %s", (modified, expected) => {
    expect(ids(filterRecent(ITEMS, "", ALL_KINDS, modified, NOW))).toEqual(expected);
  });

  it("combines search, kind and range", () => {
    expect(ids(filterRecent(ITEMS, "b", ALL_KINDS, "7d", NOW))).toEqual(["b"]);
  });
});
