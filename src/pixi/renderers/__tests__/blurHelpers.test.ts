import { describe, it, expect } from "vitest";
import { pickLayerBlurRadius, pickBackgroundBlurRadius } from "../blurHelpers";
import type { Effect, ShadowEffect } from "@/types/scene";

const shadow: ShadowEffect = {
  type: "shadow",
  shadowType: "outer",
  color: "#00000040",
  offset: { x: 0, y: 2 },
  blur: 4,
  spread: 0,
};

describe("pickLayerBlurRadius", () => {
  it("returns null for an empty stack", () => {
    expect(pickLayerBlurRadius([])).toBeNull();
  });

  it("returns null when the stack has only shadows", () => {
    expect(pickLayerBlurRadius([shadow])).toBeNull();
  });

  it("returns the radius of a blur effect", () => {
    const effects: Effect[] = [shadow, { type: "blur", radius: 6 }];
    expect(pickLayerBlurRadius(effects)).toBe(6);
  });

  it("first blur in the stack wins when there are several", () => {
    const effects: Effect[] = [
      { type: "blur", radius: 3 },
      { type: "blur", radius: 9 },
    ];
    expect(pickLayerBlurRadius(effects)).toBe(3);
  });

  it("ignores blurs with radius <= 0", () => {
    expect(pickLayerBlurRadius([{ type: "blur", radius: 0 }])).toBeNull();
    expect(
      pickLayerBlurRadius([
        { type: "blur", radius: 0 },
        { type: "blur", radius: 5 },
      ]),
    ).toBe(5);
  });

  it("ignores background-blur effects", () => {
    expect(pickLayerBlurRadius([{ type: "background-blur", radius: 6 }])).toBeNull();
  });
});

describe("pickBackgroundBlurRadius", () => {
  it("returns null for an empty stack", () => {
    expect(pickBackgroundBlurRadius([])).toBeNull();
  });

  it("returns null when the stack has only shadows or layer blur", () => {
    expect(pickBackgroundBlurRadius([shadow, { type: "blur", radius: 5 }])).toBeNull();
  });

  it("returns the radius of a background-blur effect", () => {
    const effects: Effect[] = [shadow, { type: "background-blur", radius: 10 }];
    expect(pickBackgroundBlurRadius(effects)).toBe(10);
  });

  it("first background-blur in the stack wins when there are several", () => {
    const effects: Effect[] = [
      { type: "background-blur", radius: 3 },
      { type: "background-blur", radius: 9 },
    ];
    expect(pickBackgroundBlurRadius(effects)).toBe(3);
  });

  it("ignores background blurs with radius <= 0", () => {
    expect(pickBackgroundBlurRadius([{ type: "background-blur", radius: 0 }])).toBeNull();
    expect(
      pickBackgroundBlurRadius([
        { type: "background-blur", radius: 0 },
        { type: "background-blur", radius: 5 },
      ]),
    ).toBe(5);
  });
});
