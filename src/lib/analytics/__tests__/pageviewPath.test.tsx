import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { pageviewPath } from "../pageviewPath";
import { RouteTracker } from "../RouteTracker";
import { capturePageview } from "../index";

vi.mock("../index", () => ({ capturePageview: vi.fn() }));

describe("pageviewPath", () => {
  it("hides a trace id and leaves other paths alone", () => {
    expect(pageviewPath("/trace/abc-123")).toBe("/trace/:id");
    expect(pageviewPath("/base/trace/abc-123/")).toBe("/base/trace/:id");
    expect(pageviewPath("/app")).toBe("/app");
    expect(pageviewPath("/c/xyz")).toBe("/c/xyz");
  });

  it("RouteTracker reports the normalized path", () => {
    render(
      <MemoryRouter initialEntries={["/trace/secret-id?src=cloud"]}>
        <RouteTracker />
      </MemoryRouter>,
    );
    expect(capturePageview).toHaveBeenCalledWith("/trace/:id");
  });
});
