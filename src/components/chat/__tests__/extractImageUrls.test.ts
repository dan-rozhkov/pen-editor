import { describe, it, expect } from "vitest";
import { extractImageUrls } from "@/components/chat/extractImageUrls";

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
