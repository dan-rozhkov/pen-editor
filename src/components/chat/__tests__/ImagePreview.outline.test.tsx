import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ImagePreview } from "../MessageList";

afterEach(cleanup);

describe("<ImagePreview /> outline", () => {
  it("applies the img-outline utility to the thumbnail", () => {
    render(<ImagePreview url="https://example.com/a.png" alt="a screenshot" />);

    const img = screen.getByAltText("a screenshot");
    expect(img.className).toContain("img-outline");
  });
});
