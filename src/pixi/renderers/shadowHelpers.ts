import { Container, Graphics, BlurFilter } from "pixi.js";
import type { ShadowEffect } from "@/types/scene";
import { parseHexAlpha } from "@/utils/shadowUtils";
import { parseColor } from "./colorHelpers";

export type ShadowShape = "rect" | "ellipse";

export function applyShadow(
  container: Container,
  effect: ShadowEffect | undefined,
  width: number,
  height: number,
  cornerRadius?: number,
  shape: ShadowShape = "rect",
): void {
  // Remove existing shadow layer
  const existing = container.getChildByLabel("shadow-layer");
  if (existing) {
    container.removeChild(existing);
    existing.destroy({ children: true });
  }

  if (!effect) return;

  const { color: hexColor, opacity } = parseHexAlpha(effect.color);

  // Create shadow as a blurred shape behind the node
  const shadowContainer = new Container();
  shadowContainer.label = "shadow-layer";
  shadowContainer.position.set(effect.offset.x, effect.offset.y);

  const shadowGfx = new Graphics();
  if (shape === "ellipse") {
    shadowGfx.ellipse(width / 2, height / 2, width / 2, height / 2);
  } else {
    const radius = Math.max(
      0,
      Math.min(cornerRadius ?? 0, width / 2, height / 2),
    );
    if (radius > 0) {
      shadowGfx.roundRect(0, 0, width, height, radius);
    } else {
      shadowGfx.rect(0, 0, width, height);
    }
  }
  shadowGfx.fill({ color: parseColor(hexColor), alpha: opacity });
  shadowContainer.addChild(shadowGfx);

  if (effect.blur > 0) {
    shadowContainer.filters = [new BlurFilter({
      strength: effect.blur / 2,
      quality: 3,
    })];
  }

  // Insert at index 0 so shadow is behind everything
  container.addChildAt(shadowContainer, 0);
}
