import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

afterEach(cleanup);

describe("<Button /> radius", () => {
  it.each([
    ["xs", "rounded-control-xs"],
    ["sm", "rounded-control-sm"],
    ["default", "rounded-control"],
    ["lg", "rounded-control-lg"],
    ["icon", "rounded-control"],
    ["icon-xs", "rounded-control-xs"],
    ["icon-sm", "rounded-control-sm"],
    ["icon-lg", "rounded-control-lg"],
  ] as const)("size %s uses %s", (size, cls) => {
    render(<Button size={size}>x</Button>);
    const tokens = screen.getByRole("button").className.split(/\s+/);
    expect(tokens).toContain(cls);
    expect(tokens.filter((t) => t.startsWith("rounded-"))).toEqual([cls]);
  });

  it("outline is raised, not bordered; accent glows", () => {
    render(
      <>
        <Button variant="outline">o</Button>
        <Button variant="accent">a</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "o" }).className).toContain("control-raised");
    expect(screen.getByRole("button", { name: "o" }).className).not.toContain("border-border");
    // The base `border-transparent` sorts after the custom utility in the
    // compiled CSS, so the hairline colour must come from a merged class.
    expect(screen.getByRole("button", { name: "o" }).className).toContain("border-menu-border");
    expect(screen.getByRole("button", { name: "o" }).className).not.toContain("border-transparent");
    expect(screen.getByRole("button", { name: "a" }).className).toContain("control-glow");
  });
});

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
