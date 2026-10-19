import { describe, expect, it } from "vitest";
import { renderMermaid } from "@/components/doc/extensions/mermaidRender";

describe("renderMermaid", () => {
  it("renders no links from click directives", async () => {
    const svg = await renderMermaid('flowchart LR\n  A --> B\n  click A href "https://evil.example" _blank');
    expect(svg).toContain("<svg");
    expect(svg).not.toMatch(/<a\b[^>]*href/i);
    expect(svg).not.toContain("evil.example");
  });
});
