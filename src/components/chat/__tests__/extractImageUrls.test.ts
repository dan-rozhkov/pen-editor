import { describe, it, expect } from "vitest";
import { extractImageRefs, extractImageUrls } from "@/components/chat/extractImageUrls";

describe("extractImageUrls", () => {
  it("extracts a data:image URL from a tool output object (string-encoded)", () => {
    const output = JSON.stringify({ url: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" });
    expect(extractImageUrls(output)).toEqual([
      "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    ]);
  });

  it("extracts a data:image URL from a plain object output", () => {
    const output = { url: "data:image/png;base64,iVBORw0KGgo=", prompt: "a cat" };
    expect(extractImageUrls(output)).toEqual(["data:image/png;base64,iVBORw0KGgo="]);
  });

  it("still extracts hosted https image URLs", () => {
    const output = { url: "https://cdn.example.com/pen-editor/x.png" };
    expect(extractImageUrls(output)).toEqual([
      "https://cdn.example.com/pen-editor/x.png",
    ]);
  });

  it("ignores non-image data URLs", () => {
    const output = { url: "data:text/html;base64,PGgxPmhpPC9oMT4=" };
    expect(extractImageUrls(output)).toEqual([]);
  });

  it("returns nothing for a plain text output with no image url", () => {
    expect(extractImageUrls("no image here")).toEqual([]);
  });
});

describe("extractImageRefs — Mobbin-shaped MCP output", () => {
  const mobbin = {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          results: [
            { mobbin_url: "https://mobbin.com/screens/1", image_url: "https://bytescale.mobbin.com/FW25bBB/image/abc" },
            { mobbin_url: "https://mobbin.com/screens/2", image_url: "https://bytescale.mobbin.com/FW25bBB/image/def" },
          ],
        }),
      },
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ],
  };

  it("finds image_url inside JSON-in-text and pairs it with mobbin_url", () => {
    expect(extractImageRefs(mobbin)).toEqual([
      { url: "https://bytescale.mobbin.com/FW25bBB/image/abc", sourceUrl: "https://mobbin.com/screens/1" },
      { url: "https://bytescale.mobbin.com/FW25bBB/image/def", sourceUrl: "https://mobbin.com/screens/2" },
    ]);
  });

  it("handles an image_url without a recognizable image extension", () => {
    const out = { content: [{ type: "text", text: JSON.stringify({ mobbin_url: "https://mobbin.com/s", image_url: "https://cdn.example.com/x?sig=1" }) }] };
    expect(extractImageRefs(out)).toEqual([{ url: "https://cdn.example.com/x?sig=1", sourceUrl: "https://mobbin.com/s" }]);
  });

  it("extractImageUrls stays in sync and omits sourceUrl when none is cited", () => {
    expect(extractImageUrls(mobbin)).toHaveLength(2);
    expect(extractImageRefs({ url: "https://cdn.example.com/x.png" })).toEqual([
      { url: "https://cdn.example.com/x.png" },
    ]);
  });

  it("inherits the nearest ancestor citation; a closer one wins", () => {
    const out = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            mobbin_url: "https://mobbin.com/app",
            screens: [
              { image_url: "https://cdn.example.com/a.png" },
              { mobbin_url: "https://mobbin.com/own", image_url: "https://cdn.example.com/b.png" },
            ],
          }),
        },
      ],
    };
    expect(extractImageRefs(out)).toEqual([
      { url: "https://cdn.example.com/a.png", sourceUrl: "https://mobbin.com/app" },
      { url: "https://cdn.example.com/b.png", sourceUrl: "https://mobbin.com/own" },
    ]);
  });
});
