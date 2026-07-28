import { describe, expect, it } from "vitest";
import {
  getShowcaseModelLabel,
  groupScreensByApp,
} from "@/components/showcase/showcaseApps";
import type { ShowcaseScreen } from "@/lib/showcase";

function screen(id: string, runId: string): ShowcaseScreen {
  return {
    id,
    runId,
    theme: "light",
    title: id,
    model: "test/model",
    imageUrl: `https://example.com/${id}.png`,
    htmlUrl: `https://example.com/${id}.html`,
    width: 390,
    height: 844,
    createdAt: "2026-07-28T00:00:00.000Z",
  };
}

describe("groupScreensByApp", () => {
  it("groups screens from the same run without changing feed order", () => {
    expect(
      groupScreensByApp([
        screen("a1", "run-a"),
        screen("b1", "run-b"),
        screen("a2", "run-a"),
      ]),
    ).toEqual([
      { runId: "run-a", screens: [screen("a1", "run-a"), screen("a2", "run-a")] },
      { runId: "run-b", screens: [screen("b1", "run-b")] },
    ]);
  });

  it("uses friendly editor labels for model badges", () => {
    expect(getShowcaseModelLabel("google/gemini-2.5-flash")).toBe(
      "Gemini 2.5 Flash",
    );
    expect(getShowcaseModelLabel("test/model")).toBe("Model");
  });
});
