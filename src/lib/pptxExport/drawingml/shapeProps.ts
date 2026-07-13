import { pxToEmu, degTo60k, alphaToXml } from "../xml";
import type { PptxRect, FillInput, StrokeInput, ShadowInput } from "../types";

export function xfrmXml(rect: PptxRect, rotationDeg?: number): string {
  const rot = rotationDeg ? ` rot="${degTo60k(rotationDeg)}"` : "";
  return (
    `<a:xfrm${rot}>` +
    `<a:off x="${pxToEmu(rect.x)}" y="${pxToEmu(rect.y)}"/>` +
    `<a:ext cx="${pxToEmu(rect.width)}" cy="${pxToEmu(rect.height)}"/>` +
    "</a:xfrm>"
  );
}

export function ellipseGeometryXml(): string {
  return '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>';
}

export function rectGeometryXml(
  rect: PptxRect,
  cornerRadii?: [number, number, number, number],
): string {
  const radii = (cornerRadii ?? [0, 0, 0, 0]).map((r) =>
    Math.max(0, Math.min(r, rect.width / 2, rect.height / 2)),
  ) as [number, number, number, number];

  if (radii.every((r) => r === 0)) {
    return '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  }

  const uniform = radii.every((r) => r === radii[0]);
  if (uniform) {
    // roundRect adj: radius as a fraction of half the smaller side, 0..50000.
    const minSide = Math.min(rect.width, rect.height);
    const adj = Math.min(50000, Math.round((radii[0] / minSide) * 100000));
    return `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`;
  }

  return roundedRectCustGeom(rect.width, rect.height, radii);
}

/**
 * custGeom path for a rect with per-corner radii [TL, TR, BR, BL].
 * Path coordinate space = the shape's own EMU extent. arcTo angles: DrawingML
 * measures from the positive x-axis, clockwise, in 60000ths of a degree.
 */
function roundedRectCustGeom(
  widthPx: number,
  heightPx: number,
  [tl, tr, br, bl]: [number, number, number, number],
): string {
  const w = pxToEmu(widthPx);
  const h = pxToEmu(heightPx);
  const e = (px: number) => pxToEmu(px);
  const DEG = 60000;
  const parts: string[] = [];

  parts.push(`<a:moveTo><a:pt x="${e(tl)}" y="0"/></a:moveTo>`);
  parts.push(`<a:lnTo><a:pt x="${w - e(tr)}" y="0"/></a:lnTo>`);
  if (tr > 0) parts.push(`<a:arcTo wR="${e(tr)}" hR="${e(tr)}" stAng="${270 * DEG}" swAng="${90 * DEG}"/>`);
  parts.push(`<a:lnTo><a:pt x="${w}" y="${h - e(br)}"/></a:lnTo>`);
  if (br > 0) parts.push(`<a:arcTo wR="${e(br)}" hR="${e(br)}" stAng="0" swAng="${90 * DEG}"/>`);
  parts.push(`<a:lnTo><a:pt x="${e(bl)}" y="${h}"/></a:lnTo>`);
  if (bl > 0) parts.push(`<a:arcTo wR="${e(bl)}" hR="${e(bl)}" stAng="${90 * DEG}" swAng="${90 * DEG}"/>`);
  parts.push(`<a:lnTo><a:pt x="0" y="${e(tl)}"/></a:lnTo>`);
  if (tl > 0) parts.push(`<a:arcTo wR="${e(tl)}" hR="${e(tl)}" stAng="${180 * DEG}" swAng="${90 * DEG}"/>`);
  parts.push("<a:close/>");

  return (
    "<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/>" +
    `<a:rect l="0" t="0" r="${w}" b="${h}"/>` +
    `<a:pathLst><a:path w="${w}" h="${h}">${parts.join("")}</a:path></a:pathLst>` +
    "</a:custGeom>"
  );
}

export function srgbXml(rgb: string, alpha: number): string {
  // exported: reused by textBody.ts for run-color fills
  const a = alphaToXml(alpha);
  return a === "" ? `<a:srgbClr val="${rgb}"/>` : `<a:srgbClr val="${rgb}">${a}</a:srgbClr>`;
}

export function fillXml(fill: FillInput | undefined): string {
  if (!fill) return "";
  if (fill.kind === "solid") {
    return `<a:solidFill>${srgbXml(fill.rgb, fill.alpha)}</a:solidFill>`;
  }
  const stops = fill.stops
    .map((s) => `<a:gs pos="${Math.round(s.position * 100000)}">${srgbXml(s.rgb, s.alpha)}</a:gs>`)
    .join("");
  const shade =
    fill.gradientType === "linear"
      ? `<a:lin ang="${degTo60k(fill.angleDeg)}" scaled="1"/>`
      : '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>';
  return `<a:gradFill><a:gsLst>${stops}</a:gsLst>${shade}</a:gradFill>`;
}

export function strokeXml(stroke: StrokeInput | undefined): string {
  if (!stroke || stroke.widthPx <= 0) return "";
  return `<a:ln w="${pxToEmu(stroke.widthPx)}"><a:solidFill>${srgbXml(stroke.rgb, stroke.alpha)}</a:solidFill></a:ln>`;
}

export function effectsXml(shadows: ShadowInput[] | undefined): string {
  if (!shadows || shadows.length === 0) return "";
  // CT_EffectList is a strict sequence: innerShdw must precede outerShdw.
  // Emit all inner shadows first (stable within each group) so stricter
  // readers (Keynote / Google Slides) accept the package.
  const ordered = [
    ...shadows.filter((s) => s.variant === "inner"),
    ...shadows.filter((s) => s.variant !== "inner"),
  ];
  const items = ordered
    .map((s) => {
      const tag = s.variant === "outer" ? "outerShdw" : "innerShdw";
      const dist = pxToEmu(Math.hypot(s.offsetX, s.offsetY));
      const dir = degTo60k((Math.atan2(s.offsetY, s.offsetX) * 180) / Math.PI);
      const rotAttr = s.variant === "outer" ? ' rotWithShape="0"' : "";
      return `<a:${tag} blurRad="${pxToEmu(s.blurPx)}" dist="${dist}" dir="${dir}"${rotAttr}>${srgbXml(s.rgb, s.alpha)}</a:${tag}>`;
    })
    .join("");
  return `<a:effectLst>${items}</a:effectLst>`;
}
