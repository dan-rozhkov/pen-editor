import { Container, Graphics, BlurFilter } from "pixi.js";
import type { ShadowEffect } from "@/types/scene";
import { parseHexAlpha } from "@/utils/shadowUtils";
import { parseColor } from "./colorHelpers";

export function applyShadow(container: Container, effect: ShadowEffect | undefined, width: number, height: number): void {
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
  shadowGfx.rect(0, 0, width, height);
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
