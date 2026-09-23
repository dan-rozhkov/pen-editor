import { describe, it, expect, beforeEach } from "vitest";
import {
  recordTouchedEmbeds,
  takeTouchedEmbeds,
  resetTouchedEmbedsRegistry,
  touchedEmbedsRegistrySize,
} from "@/lib/tools/tasteCheckRegistry";

beforeEach(() => {
  resetTouchedEmbedsRegistry();
});

describe("tasteCheckRegistry", () => {
  it("returns recorded ids exactly once, then empty", () => {
    recordTouchedEmbeds("call-1", ["e1", "e2"]);
    expect(takeTouchedEmbeds("call-1")).toEqual({ touched: ["e1", "e2"], created: [] });
    expect(takeTouchedEmbeds("call-1")).toEqual({ touched: [], created: [] });
  });

  it("records created ids alongside touched ones", () => {
    recordTouchedEmbeds("call-1", ["e1", "e2"], ["e1"]);
    expect(takeTouchedEmbeds("call-1")).toEqual({ touched: ["e1", "e2"], created: ["e1"] });
  });

  it("take() deletes the entry so the registry does not grow unbounded across many calls", () => {
    recordTouchedEmbeds("call-1", ["e1"]);
    expect(touchedEmbedsRegistrySize()).toBe(1);
    takeTouchedEmbeds("call-1");
    expect(touchedEmbedsRegistrySize()).toBe(0);
  });

  it("returns empty for an unknown or undefined toolCallId, without recording", () => {
    expect(takeTouchedEmbeds("nope")).toEqual({ touched: [], created: [] });
    expect(takeTouchedEmbeds(undefined)).toEqual({ touched: [], created: [] });
  });

  it("is a no-op when recording with no toolCallId or empty id lists", () => {
    recordTouchedEmbeds(undefined, ["e1"]);
    recordTouchedEmbeds("call-2", []);
    expect(touchedEmbedsRegistrySize()).toBe(0);
  });

  it("records when only createdIds is non-empty", () => {
    recordTouchedEmbeds("call-created-only", [], ["e1"]);
    expect(touchedEmbedsRegistrySize()).toBe(1);
    expect(takeTouchedEmbeds("call-created-only")).toEqual({ touched: [], created: ["e1"] });
  });

  it("bounds the map size by evicting the oldest entry", () => {
    // MAX_ENTRIES is 200 — fill past it and confirm the size never exceeds
    // the bound and the oldest entries are the ones dropped.
    for (let i = 0; i < 205; i++) {
      recordTouchedEmbeds(`call-${i}`, [`e${i}`]);
    }
    expect(touchedEmbedsRegistrySize()).toBeLessThanOrEqual(200);
    // The very first calls should have been evicted.
    expect(takeTouchedEmbeds("call-0")).toEqual({ touched: [], created: [] });
    // A recent call should still be present.
    expect(takeTouchedEmbeds("call-204")).toEqual({ touched: ["e204"], created: [] });
  });
});
