import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NodeIcon } from "../LayerIcons";

describe("<NodeIcon />", () => {
  it("uses the component accent for component and instance icons", () => {
    const { container, rerender } = render(<NodeIcon type="frame" isComponent />);
    expect(container.querySelector("svg")?.classList.contains("text-accent-bright")).toBe(true);

    rerender(<NodeIcon type="ref" />);
    expect(container.querySelector("svg")?.classList.contains("text-accent-bright")).toBe(true);
  });
});
