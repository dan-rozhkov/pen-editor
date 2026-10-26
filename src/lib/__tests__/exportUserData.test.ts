import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "@/lib/docs/docStore";
import { createWorkflow, stepsFromTexts } from "@/lib/workflows/workflowStore";

import { buildUserDataExport, exportFileName } from "../exportUserData";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("buildUserDataExport", () => {
  it("collects local and remote parts", async () => {
    createDoc({ title: "Notes", markdown: "hi" }, "editor");
    createWorkflow({ title: "Flow", steps: stepsFromTexts(["one"]) }, "editor");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).startsWith("/api/user-skills")
          ? json({ skills: [{ name: "s1" }], available: true })
          : json({ available: true, enabled: true, memory: ["m"], user: [], limits: { memory: 1, user: 1 } }),
      ),
    );
    const out = await buildUserDataExport(new Date("2026-10-26T10:00:00Z"));
    expect(out.exportedAt).toBe("2026-10-26T10:00:00.000Z");
    expect(out.docs).toMatchObject([{ title: "Notes", markdown: "hi" }]);
    expect(out.workflows).toMatchObject([{ title: "Flow" }]);
    expect(out.skills).toEqual([{ name: "s1" }]);
    expect(out.memory).toMatchObject({ memory: ["m"] });
  });

  it("keeps the file when a remote part fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).startsWith("/api/memory") ? json({ error: "boom" }, 500) : json({ skills: [], available: true }),
      ),
    );
    const out = await buildUserDataExport();
    expect(out.memory).toEqual({ error: "boom" });
    expect(out.skills).toEqual([]);
    expect(Array.isArray(out.docs)).toBe(true);
  });
});

describe("exportFileName", () => {
  it("uses the date", () => {
    expect(exportFileName(new Date("2026-10-26T10:00:00Z"))).toBe("sideform-data-2026-10-26.json");
  });
});
