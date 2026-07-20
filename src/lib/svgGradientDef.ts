import type { GradientFill } from "@/types/scene";

/** Build a `<linearGradient>`/`<radialGradient>` def for a gradient paint, shared by designToHtml/svgGeneration and designToSvg/shapeStyles. */
export function gradientToSvgDef(g: GradientFill, id: string): string {
  const stops = [...g.stops]
    .sort((a, b) => a.position - b.position)
    .map(
      (s) =>
        `<stop offset="${s.position}" stop-color="${s.color}"${
          s.opacity != null && s.opacity !== 1 ? ` stop-opacity="${s.opacity}"` : ""
        }/>`,
    )
    .join("");
  if (g.type === "radial") {
    const r = g.endRadius ?? (Math.hypot(g.endX - g.startX, g.endY - g.startY) || 0.5);
    return `<radialGradient id="${id}" cx="${g.startX}" cy="${g.startY}" r="${r}">${stops}</radialGradient>`;
  }
  return `<linearGradient id="${id}" x1="${g.startX}" y1="${g.startY}" x2="${g.endX}" y2="${g.endY}">${stops}</linearGradient>`;
}
