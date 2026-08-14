import { describe, it, expect } from "vitest";
import { analyzeImage } from "@/lib/tools/analyzeImage";

describe("analyze_image (frontend handler)", () => {
  // This tool is backend-executed (pen-editor-backend's makeAnalyzeImageTool
  // calls the auxiliary vision model server-side) — the built-in chat never
  // invokes this handler via onToolCall. It exists solely to satisfy the
  // tool-name contract and to fail clearly if ever reached directly (e.g. an
  // MCP bridge call).
  it("returns a descriptive error instead of throwing or hanging", async () => {
    const result = JSON.parse(await analyzeImage({ imageUrl: "https://example.com/x.png" }));
    expect(result.error).toMatch(/backend/i);
  });

  it("ignores args and never throws regardless of input shape", async () => {
    await expect(analyzeImage({})).resolves.toBeTypeOf("string");
    await expect(analyzeImage({ question: "what color?" })).resolves.toBeTypeOf("string");
  });
});
