import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { UsageReportView } from "../UsageReportDialog";
import type { UsageReport } from "@/lib/dsReport";

const report: UsageReport = {
  schemaVersion: 1,
  nodes: 10,
  embeds: 1,
  tokens: { bindable: 8, bound: 6, boundToLibrary: 4, literal: 2, use: {}, embed: { varRefs: 3, literals: 1 } },
  components: { instances: 5, libraryInstances: 4, detached: 1, use: {}, detachedByKey: {} },
  lint: { "hardcoded-value": 2, "off-scale-value": 0, contrast: 0, "deprecated-token": 0, "deprecated-component": 0, "embed-literal": 0, "component-drift": 0 },
  libraries: [
    {
      libraryId: "lib1",
      version: "1.0.0",
      reportUsage: false,
      tokens: { total: 5, used: 3, unused: 2 },
      components: { total: 2, used: 1, unused: 1 },
      unusedTokenIds: ["v-a", "v-b"],
      unusedComponentKeys: ["card"],
    },
  ],
  truncated: true,
};

describe("UsageReportView", () => {
  it("shows coverage, lint counts and the library breakdown", () => {
    render(<UsageReportView report={report} />);
    expect(screen.getByText("75% (6 of 8)")).toBeTruthy();
    expect(screen.getByText("hardcoded-value")).toBeTruthy();
    expect(screen.getByText("lib1 @ 1.0.0")).toBeTruthy();
    expect(screen.getByText("3 of 5")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/some numbers may be low/);
  });
});
