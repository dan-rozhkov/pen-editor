import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShowcasePublishSection } from "@/components/properties/ShowcasePublishSection";

const screens = [
  {
    nodeId: "embed1",
    name: "Home",
    x: 0,
    y: 0,
    width: 390,
    height: 844,
  },
];

afterEach(cleanup);

describe("ShowcasePublishSection", () => {
  it("uses sentence case for a single-screen publish", () => {
    render(<ShowcasePublishSection screens={screens} defaultName="My app" />);

    expect(
      screen.getByRole("button", { name: "Publish to showcase" }),
    ).toBeTruthy();
  });

  it("includes the selected screen count for multi-screen publish", () => {
    render(
      <ShowcasePublishSection
        screens={[
          ...screens,
          {
            nodeId: "embed2",
            name: "Details",
            x: 410,
            y: 0,
            width: 390,
            height: 844,
          },
        ]}
        defaultName="My app"
      />,
    );

    expect(screen.getByRole("button", { name: "Publish 2 screens" })).toBeTruthy();
  });

  it("keeps the app name in a settings popover", () => {
    render(<ShowcasePublishSection screens={screens} defaultName="My app" />);

    expect(screen.queryByText("App name")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Showcase settings" }));

    expect(screen.getByText("App name")).toBeTruthy();
    expect(screen.getByDisplayValue("My app")).toBeTruthy();
  });
});
