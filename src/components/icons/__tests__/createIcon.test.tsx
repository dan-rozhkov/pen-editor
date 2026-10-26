import type { ReactElement } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { createIcon, IconContext, type IconProps } from "@/components/icons";

afterEach(cleanup);

const Outline = createIcon("Outline", <path data-part="outline" d="M2 8h12" />);
const Both = createIcon(
  "Both",
  <path data-part="outline" d="M2 8h12" />,
  (uid) => <path data-part="fill" data-uid={uid} d="M2 2h12v12H2Z" />,
);

function svgOf(el: ReactElement) {
  const { container } = render(el);
  const svg = container.querySelector("svg");
  expect(svg).not.toBeNull();
  return svg!;
}

describe("createIcon", () => {
  it("renders a stroked 16-unit glyph that inherits the text colour", () => {
    const svg = svgOf(<Outline />);
    expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(svg.getAttribute("data-pen-icon")).toBe("Outline");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("stroke-linecap")).toBe("round");
    expect(svg.getAttribute("width")).toBe("1em");
  });

  it.each<[IconProps, string]>([
    [{}, "1.25"],
    [{ weight: "light" }, "1.25"],
    [{ weight: "thin" }, "1"],
    [{ weight: "bold" }, "1.5"],
    [{ size: 24 }, "1.5"],
    [{ size: 24, weight: "bold" }, "1.75"],
    [{ size: 20 }, "1.25"],
  ])("stroke width for %o is %s", (props, width) => {
    expect(svgOf(<Outline {...props} />).getAttribute("stroke-width")).toBe(width);
  });

  it("honours the Phosphor-style props used across the app", () => {
    const svg = svgOf(<Outline size={14} color="#ff0000" className="shrink-0" mirrored alt="Label" />);
    expect(svg.getAttribute("width")).toBe("14");
    expect(svg.getAttribute("height")).toBe("14");
    // On the svg's own `color`, so every currentColor paint inside follows it.
    expect(svg.getAttribute("color")).toBe("#ff0000");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("class")).toBe("shrink-0");
    expect(svg.getAttribute("transform")).toBe("scale(-1, 1)");
    expect(svg.querySelector("title")?.textContent).toBe("Label");
  });

  it("switches to the solid variant for weight=fill", () => {
    const svg = svgOf(<Both weight="fill" color="red" />);
    expect(svg.getAttribute("color")).toBe("red");
    expect(svg.getAttribute("fill")).toBe("currentColor");
    expect(svg.getAttribute("stroke")).toBe("none");
    expect(svg.getAttribute("data-weight")).toBe("fill");
    expect(svg.querySelector('[data-part="outline"]')).toBeNull();
    expect(svg.querySelector('[data-part="fill"]')?.getAttribute("data-uid")).toMatch(/\S/);
  });

  it("falls back to the outline when a glyph has no fill variant", () => {
    const svg = svgOf(<Outline weight="fill" />);
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.querySelector('[data-part="outline"]')).not.toBeNull();
  });

  it("takes defaults from IconContext and lets props override them", () => {
    const svg = svgOf(
      <IconContext.Provider value={{ weight: "bold", size: 18 }}>
        <Outline />
        <Outline weight="thin" />
      </IconContext.Provider>,
    );
    expect(svg.getAttribute("stroke-width")).toBe("1.5");
    expect(svg.getAttribute("width")).toBe("18");
    const second = svg.parentElement!.querySelectorAll("svg")[1];
    expect(second.getAttribute("stroke-width")).toBe("1");
  });

  it("applies optics to both variants, scaled about the grid centre", () => {
    const Corrected = createIcon(
      "Corrected",
      <path data-part="outline" d="M2 8h12" />,
      (uid) => <path data-part="fill" data-uid={uid} d="M2 2h12v12H2Z" />,
      { scale: 1.1, dy: -0.2 },
    );
    const transform = "translate(8 7.8) scale(1.1) translate(-8 -8)";
    for (const weight of ["regular", "fill"] as const) {
      const g = svgOf(<Corrected weight={weight} />).querySelector("g");
      expect(g?.getAttribute("transform")).toBe(transform);
    }
    expect(svgOf(<Outline />).querySelector("g")).toBeNull();
  });
});
