import { Graphics } from "pixi.js";
import type { FlatSceneNode, PerCornerRadius } from "@/types/scene";
import { drawRoundedShape } from "./fillStrokeHelpers";

type CornerNode = FlatSceneNode & {
  cornerRadius?: number;
  cornerRadiusPerCorner?: PerCornerRadius;
  cornerSmoothing?: number;
};

/** Build a shape mask matching the node outline (ellipse or rounded-rect) at
 *  the given rendered size, labeled `label`. Shared by the shader-fill and
 *  background-blur bakers, which both mask their baked sprite to the node's
 *  own shape. */
export function buildShapeMask(node: FlatSceneNode, width: number, height: number, label: string): Graphics {
  const mask = new Graphics();
  mask.label = label;
  if (node.type === "ellipse") {
    mask.ellipse(width / 2, height / 2, width / 2, height / 2);
  } else {
    const cn = node as CornerNode;
    drawRoundedShape(mask, width, height, cn.cornerRadius, cn.cornerRadiusPerCorner, cn.cornerSmoothing);
  }
  mask.fill(0xffffff);
  return mask;
}
