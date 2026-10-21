import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiBase", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "@/lib/apiBase";
import { getCachedDocTemplates, loadDocTemplates, resetDocTemplatesCache, titleAfterTemplate } from "../docTemplates";

const template = { id: "bug-report", skill: "x", label: "Bug report", title: "Bug report: [Area]", description: "d", markdown: "Body\n" };
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

beforeEach(() => {
  resetDocTemplatesCache();
  vi.mocked(apiFetch).mockReset();
});

describe("loadDocTemplates", () => {
  it("loads once and serves the cache afterwards", async () => {
    vi.mocked(apiFetch).mockResolvedValue(ok({ templates: [template] }));
    expect(await loadDocTemplates()).toEqual([template]);
    expect(await loadDocTemplates()).toEqual([template]);
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith("/api/doc-templates");
    expect(getCachedDocTemplates()).toEqual([template]);
  });

  it.each([
    ["a network error", () => vi.mocked(apiFetch).mockRejectedValue(new Error("down"))],
    ["an error status", () => vi.mocked(apiFetch).mockResolvedValue({ ok: false } as Response)],
    ["a malformed body", () => vi.mocked(apiFetch).mockResolvedValue(ok({ templates: "x" }))],
  ])("resolves null on %s and retries next time", async (_name, arrange) => {
    arrange();
    expect(await loadDocTemplates()).toBeNull();
    expect(getCachedDocTemplates()).toBeNull();
    vi.mocked(apiFetch).mockResolvedValue(ok({ templates: [template] }));
    expect(await loadDocTemplates()).toEqual([template]);
  });
});

describe("titleAfterTemplate", () => {
  it.each([
    ["", "T", "T"],
    ["   ", "T", "T"],
    ["Untitled", "T", "T"],
    [" Untitled ", "T", "T"],
    ["Mine", "T", null],
  ])("title %j + template %j -> %j", (current, tpl, expected) => {
    expect(titleAfterTemplate(current, tpl)).toBe(expected);
  });
});
