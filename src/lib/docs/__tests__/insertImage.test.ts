import { describe, expect, it } from "vitest";
import { buildImageMarkdown, insertImageIntoMarkdown } from "../insertImage";
import { assertErr, assertOk } from "@/test/assertions";

const IMG = "![x](https://a/b.png)";

describe("buildImageMarkdown", () => {
  it.each([
    ["plain", "A cat", "https://a/b.png", "![A cat](https://a/b.png)"],
    ["brackets", "a [b] c", "https://a/b.png", "![a \\[b\\] c](https://a/b.png)"],
    ["newlines", "a\nb\r\nc", "https://a/b.png", "![a b c](https://a/b.png)"],
    ["spaces in url", "x", "https://a/b c.png", "![x](<https://a/b c.png>)"],
    ["parens in url", "x", "https://a/b(1).png", "![x](<https://a/b(1).png>)"],
  ])("%s", (_name, alt, url, expected) => {
    expect(buildImageMarkdown(alt, url)).toBe(expected);
  });
});

describe("insertImageIntoMarkdown", () => {
  const insert = (md: string, heading?: string) => {
    const r = insertImageIntoMarkdown(md, IMG, heading);
    assertOk(r);
    return r.markdown;
  };

  it.each([
    ["empty doc", "", `${IMG}\n`],
    ["end of doc", "# T\n\ntext\n", `# T\n\ntext\n\n${IMG}\n`],
    ["no trailing newline", "# T\ntext", `# T\ntext\n\n${IMG}\n`],
  ])("appends: %s", (_n, md, expected) => {
    expect(insert(md)).toBe(expected);
  });

  it.each([
    ["before the next heading", "# A\n\none\n\n# B\n\ntwo\n", "A", `# A\n\none\n\n${IMG}\n\n# B\n\ntwo\n`],
    ["case-insensitive, trailing #s", "## Intro ##\nx\n## End\n", "intro", `## Intro ##\nx\n\n${IMG}\n\n## End\n`],
    ["last section", "# A\n\none\n# B\ntwo", "B", `# A\n\none\n# B\ntwo\n\n${IMG}\n`],
    ["subsections stay inside", "# A\n## A1\nx\n# B\n", "A", `# A\n## A1\nx\n\n${IMG}\n\n# B\n`],
    ["sub heading ends at higher level", "# A\n## A1\nx\n## A2\ny\n", "A1", `# A\n## A1\nx\n\n${IMG}\n\n## A2\ny\n`],
    ["heading with hashes prefix in arg", "# A\nx\n# B\n", "# A", `# A\nx\n\n${IMG}\n\n# B\n`],
    ["empty section", "# A\n# B\n", "A", `# A\n\n${IMG}\n\n# B\n`],
  ])("after heading: %s", (_n, md, heading, expected) => {
    expect(insert(md, heading)).toBe(expected);
  });

  it("ignores headings inside fenced code blocks", () => {
    const md = "# A\n```\n# Fake\n```\n# Real\nx\n";
    const r = insertImageIntoMarkdown(md, IMG, "Fake");
    assertErr(r);
    expect(r.error).toContain('"Real"');
    expect(insert(md, "A")).toBe(`# A\n\`\`\`\n# Fake\n\`\`\`\n\n${IMG}\n\n# Real\nx\n`);
  });

  it.each([
    ["missing heading", "# A\n", "Nope", /not found.*"A"/],
    ["doc without headings", "text", "Nope", /no headings/],
  ])("errors: %s", (_n, md, heading, pattern) => {
    const r = insertImageIntoMarkdown(md, IMG, heading);
    assertErr(r);
    expect(r.error).toMatch(pattern);
  });
});
