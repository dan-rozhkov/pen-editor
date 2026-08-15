import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ReferoIcon } from "@/components/icons/ReferoIcon";

afterEach(cleanup);

function renderIcon(props: Parameters<typeof ReferoIcon>[0] = {}) {
  const { container } = render(<ReferoIcon {...props} />);
  return container.querySelector("svg")!;
}

describe("ReferoIcon", () => {
  it("renders a stroked 256-unit icon that inherits the text colour", () => {
    const svg = renderIcon();
    expect(svg.getAttribute("viewBox")).toBe("0 0 256 256");
    // Stroked, not filled — the opposite of a stock Phosphor icon, so `color`
    // has to land on `stroke` for the chip's error state to turn it red.
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
  });

  it("honours the Phosphor icon props used by tool chips", () => {
    const svg = renderIcon({ size: 14, color: "#ff0000", weight: "bold", className: "shrink-0" });
    expect(svg.getAttribute("width")).toBe("14");
    expect(svg.getAttribute("height")).toBe("14");
    expect(svg.getAttribute("stroke")).toBe("#ff0000");
    expect(svg.getAttribute("stroke-width")).toBe("24");
    expect(svg.getAttribute("class")).toBe("shrink-0");
  });
});
