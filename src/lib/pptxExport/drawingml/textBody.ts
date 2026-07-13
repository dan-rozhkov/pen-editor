import { escapeXml, pxToPt100 } from "../xml";
import { srgbXml } from "./shapeProps";
import type { TextShapeInput } from "../types";

export function emptyTextBodyXml(): string {
  return "<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>";
}

export function textBodyXml(shape: TextShapeInput): string {
  const { font, paragraphs, anchor } = shape;

  const rprAttrs = [
    `lang="en-US"`,
    `sz="${pxToPt100(font.sizePx)}"`,
    font.bold ? 'b="1"' : "",
    font.italic ? 'i="1"' : "",
    font.underline ? 'u="sng"' : "",
    font.strike ? 'strike="sngStrike"' : "",
    font.letterSpacingPx ? `spc="${pxToPt100(font.letterSpacingPx)}"` : "",
    'dirty="0"',
  ]
    .filter(Boolean)
    .join(" ");
  const rpr =
    `<a:rPr ${rprAttrs}>` +
    `<a:solidFill>${srgbXml(font.rgb, font.alpha)}</a:solidFill>` +
    `<a:latin typeface="${escapeXml(font.family)}"/>` +
    "</a:rPr>";

  const lnSpc = font.lineHeight
    ? `<a:lnSpc><a:spcPct val="${Math.round(font.lineHeight * 100000)}"/></a:lnSpc>`
    : "";
  const spcAft = font.paragraphSpacingPx
    ? `<a:spcAft><a:spcPts val="${pxToPt100(font.paragraphSpacingPx)}"/></a:spcAft>`
    : "";

  const ps = paragraphs
    .map((p) => {
      const pPr = `<a:pPr algn="${p.align}">${lnSpc}${spcAft}</a:pPr>`;
      const run = p.text === "" ? "" : `<a:r>${rpr}<a:t>${escapeXml(p.text)}</a:t></a:r>`;
      return `<a:p>${pPr}${run}</a:p>`;
    })
    .join("");

  return (
    "<p:txBody>" +
    `<a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}"/>` +
    "<a:lstStyle/>" +
    ps +
    "</p:txBody>"
  );
}
