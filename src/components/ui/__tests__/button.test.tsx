import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

afterEach(cleanup);

describe("<Button />", () => {
  it("carries the press-feedback class by default", () => {
    render(<Button>Click me</Button>);

    const button = screen.getByRole("button", { name: "Click me" });
    expect(button.className).toContain("active:scale-[0.96]");
  });

  it("omits the press-feedback class when static", () => {
    render(<Button static>Click me</Button>);

    const button = screen.getByRole("button", { name: "Click me" });
    expect(button.className).not.toContain("active:scale-[0.96]");
  });

  it("never leaks the static prop onto the DOM element", () => {
    render(<Button static>Click me</Button>);

    const button = screen.getByRole("button", { name: "Click me" });
    expect(button.hasAttribute("static")).toBe(false);
  });

  it("uses an explicit transition-property, never transition-all", () => {
    render(<Button>Click me</Button>);

    const button = screen.getByRole("button", { name: "Click me" });
    expect(button.className).not.toContain("transition-all");
    expect(button.className).toContain("transition-[scale]");
  });
});

describe("<Badge /> transitions", () => {
  it("does not use transition-all", () => {
    render(<Badge>New</Badge>);

    const badge = screen.getByText("New");
    expect(badge.className).not.toContain("transition-all");
  });

  it("declares an explicit transition-property covering color/background/border", () => {
    render(<Badge>New</Badge>);

    const badge = screen.getByText("New");
    expect(badge.className).toMatch(/transition-\[color,background-color,border-color\]/);
  });
});
