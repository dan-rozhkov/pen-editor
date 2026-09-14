import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IconSwap } from "@/components/ui/IconSwap";

afterEach(cleanup);

describe("<IconSwap />", () => {
  it("keeps both icons mounted and hides the inactive one from assistive tech", () => {
    render(
      <IconSwap
        active={true}
        activeIcon={<span data-testid="active-icon">A</span>}
        inactiveIcon={<span data-testid="inactive-icon">I</span>}
      />,
    );

    const activeIcon = screen.getByTestId("active-icon");
    const inactiveIcon = screen.getByTestId("inactive-icon");
    expect(activeIcon).toBeTruthy();
    expect(inactiveIcon).toBeTruthy();

    const activeLayer = activeIcon.parentElement!;
    const inactiveLayer = inactiveIcon.parentElement!;
    expect(activeLayer.getAttribute("aria-hidden")).toBe("false");
    expect(inactiveLayer.getAttribute("aria-hidden")).toBe("true");
  });

  it("swaps which icon is visible/hidden when `active` flips", () => {
    const { rerender } = render(
      <IconSwap
        active={false}
        activeIcon={<span data-testid="active-icon">A</span>}
        inactiveIcon={<span data-testid="inactive-icon">I</span>}
      />,
    );

    let activeLayer = screen.getByTestId("active-icon").parentElement!;
    let inactiveLayer = screen.getByTestId("inactive-icon").parentElement!;
    expect(activeLayer.getAttribute("aria-hidden")).toBe("true");
    expect(inactiveLayer.getAttribute("aria-hidden")).toBe("false");
    expect(activeLayer.style.opacity).toBe("0");
    expect(inactiveLayer.style.opacity).toBe("1");

    rerender(
      <IconSwap
        active={true}
        activeIcon={<span data-testid="active-icon">A</span>}
        inactiveIcon={<span data-testid="inactive-icon">I</span>}
      />,
    );

    activeLayer = screen.getByTestId("active-icon").parentElement!;
    inactiveLayer = screen.getByTestId("inactive-icon").parentElement!;
    expect(activeLayer.getAttribute("aria-hidden")).toBe("false");
    expect(inactiveLayer.getAttribute("aria-hidden")).toBe("true");
    expect(activeLayer.style.opacity).toBe("1");
    expect(inactiveLayer.style.opacity).toBe("0");
  });

  it("declares the cross-fade transition in CSS (not inline styles) so prefers-reduced-motion can override it", () => {
    render(
      <IconSwap
        active={true}
        activeIcon={<span data-testid="active-icon">A</span>}
        inactiveIcon={<span data-testid="inactive-icon">I</span>}
      />,
    );

    const activeLayer = screen.getByTestId("active-icon").parentElement!;

    // The transition must come from the `icon-swap-transition` CSS utility
    // (src/index.css), which is guarded by an actual
    // `@media (prefers-reduced-motion: reduce)` block. An inline
    // `transitionProperty`/`-Duration`/`-TimingFunction` would always win
    // over that media-query-gated CSS by specificity, silently defeating
    // prefers-reduced-motion — so assert those inline properties are
    // absent, and that the CSS utility class is present instead.
    expect(activeLayer.style.transitionProperty).toBe("");
    expect(activeLayer.style.transitionDuration).toBe("");
    expect(activeLayer.style.transitionTimingFunction).toBe("");
    expect(activeLayer.className).toContain("icon-swap-transition");

    // Only the state-dependent values remain inline.
    expect(activeLayer.style.scale).toBe("1");
    expect(activeLayer.style.opacity).toBe("1");
    expect(activeLayer.style.filter).toBe("blur(0px)");
  });
});
